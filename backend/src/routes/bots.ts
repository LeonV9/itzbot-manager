import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { Ctx } from '../app';
import { validateDiscordBot } from '../discord';
import { AppError } from '../errors';
import { extractZip, writeUploadedFile } from '../fsafe';
import { downloadRepo, parseGithubUrl } from '../github';
import { isApplicationId } from '../validation';

const appId = z.string().refine(isApplicationId, 'Application ID must be the 17–20 digit number from the Discord Developer Portal (General Information), not the bot token.');
const token = z.string().min(50, 'Bot Token looks too short. Copy it from Developer Portal → Bot → Reset Token.').max(200).regex(/^\S+$/, 'Bot Token must not contain spaces.');
const id = z.object({ id: z.string() });

export function botRoutes(ctx: Ctx) {
  const { app, cfg, svc, auth } = ctx;
  const pre = { preHandler: auth };

  app.get('/api/bots', pre, async (req) => ({ bots: await svc.list(req.userId), max: cfg.MAX_BOTS }));

  app.post('/api/bots', pre, async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(1).max(60), applicationId: appId, token,
      startCommand: z.string().optional(), env: z.record(z.string().max(4096)).optional(),
    }).parse(req.body);
    if (!cfg.SKIP_DISCORD_VALIDATION) await validateDiscordBot(b.token, b.applicationId);
    return reply.code(201).send({ bot: await svc.create(req.userId, b) });
  });

  app.get('/api/bots/:id', pre, async (req) => ({ bot: await svc.get(req.userId, id.parse(req.params).id) }));

  app.patch('/api/bots/:id', pre, async (req) => {
    const b = z.object({
      name: z.string().trim().min(1).max(60), startCommand: z.string(), entryFile: z.string().max(200).nullable(),
      env: z.record(z.string().max(4096).nullable()).refine((e) => Object.keys(e).length <= 50, 'too many variables'),
      memoryMb: z.number().int().min(64).max(cfg.MAX_BOT_MEMORY_MB).nullable(),
      cpus: z.number().min(0.1).max(cfg.MAX_BOT_CPUS).nullable(), allowInstallScripts: z.boolean(),
    }).partial().strict().parse(req.body);
    return { bot: await svc.updateConfig(req.userId, id.parse(req.params).id, b) };
  });

  // Replace the token without ever revealing the old one.
  app.put('/api/bots/:id/token', pre, async (req) => {
    const bid = id.parse(req.params).id;
    const b = z.object({ token }).parse(req.body);
    if (!cfg.SKIP_DISCORD_VALIDATION) await validateDiscordBot(b.token, await svc.applicationId(req.userId, bid));
    await svc.replaceToken(req.userId, bid, b.token);
    return { ok: true };
  });

  app.delete('/api/bots/:id', pre, async (req) => { await svc.delete(req.userId, id.parse(req.params).id); return { ok: true }; });
  app.post('/api/bots/:id/start', pre, async (req) => ({ bot: await svc.start(req.userId, id.parse(req.params).id) }));
  app.post('/api/bots/:id/stop', pre, async (req) => ({ bot: await svc.stop(req.userId, id.parse(req.params).id) }));
  app.post('/api/bots/:id/restart', pre, async (req) => ({ bot: await svc.restart(req.userId, id.parse(req.params).id) }));

  app.get('/api/bots/:id/logs', pre, async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(300), before: z.coerce.number().int().optional() }).parse(req.query);
    return { logs: await svc.history(req.userId, id.parse(req.params).id, q.limit, q.before) };
  });
  app.get('/api/bots/:id/analysis', pre, async (req) => ({ analysis: await svc.analysis(req.userId, id.parse(req.params).id) }));
  app.get('/api/imports', pre, async (req) => ({ imports: await svc.importHistory(req.userId) }));

  // ---------------- imports ----------------
  app.post('/api/bots/:id/import/zip', { ...pre, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const bid = id.parse(req.params).id;
    await svc.assertOwner(req.userId, bid);
    const file = await req.file();
    if (!file) throw new AppError(400, 'NO_FILE', 'Attach a .zip file in the "file" field.');
    if (!file.filename.toLowerCase().endsWith('.zip')) throw new AppError(400, 'NOT_A_ZIP', 'The file must have a .zip extension.');
    const tmp = path.join(os.tmpdir(), `itz-${randomUUID()}.zip`);
    try {
      await pipeline(file.file, createWriteStream(tmp));
      if (file.file.truncated) throw new AppError(413, 'UPLOAD_TOO_LARGE', `ZIP exceeds ${cfg.MAX_UPLOAD_MB} MB.`);
      return await svc.installSource(req.userId, bid, 'zip', file.filename, (staging) => extractZip(tmp, staging).then(() => undefined));
    } finally { await fs.rm(tmp, { force: true }); }
  });

  app.post('/api/bots/:id/import/github', { ...pre, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const bid = id.parse(req.params).id;
    const b = z.object({ url: z.string().max(300), ref: z.string().max(200).optional(), githubToken: z.string().max(300).optional() }).parse(req.body);
    const g = parseGithubUrl(b.url);
    await svc.assertOwner(req.userId, bid);
    const tmp = path.join(os.tmpdir(), `itz-${randomUUID()}.zip`);
    try {
      return await svc.installSource(req.userId, bid, 'github', `https://github.com/${g.owner}/${g.repo}`, async (staging) => {
        await downloadRepo(g, tmp, { token: b.githubToken, ref: b.ref, maxBytes: cfg.MAX_UPLOAD_MB * 1024 * 1024 });
        await extractZip(tmp, staging);
      });
    } finally { await fs.rm(tmp, { force: true }); }
  });

  // Manual: multipart with one part per file; each part's filename is its relative path inside the project.
  app.post('/api/bots/:id/import/manual', { ...pre, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const bid = id.parse(req.params).id;
    await svc.assertOwner(req.userId, bid);
    const max = cfg.MAX_UPLOAD_MB * 1024 * 1024;
    return svc.installSource(req.userId, bid, 'manual', 'manual upload', async (staging) => {
      let n = 0;
      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;
        if (++n > 500) throw new AppError(400, 'TOO_MANY_FILES', 'At most 500 files per manual import.');
        await writeUploadedFile(staging, part.filename, part.file, max);
        if (part.file.truncated) throw new AppError(413, 'UPLOAD_TOO_LARGE', `"${part.filename}" is too large.`);
      }
      if (!n) throw new AppError(400, 'NO_FILE', 'No files were uploaded.');
    });
  });
}
