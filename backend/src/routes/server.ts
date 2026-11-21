import { z } from 'zod';
import type { Ctx } from '../app';
import { hostMetrics } from '../metrics';
import type { ServerStatus } from '@itzbot/shared';

const started = Date.now();

export function serverRoutes(ctx: Ctx) {
  const { app, cfg, db, runtime, svc, auth } = ctx;
  const pre = { preHandler: auth };

  async function status(owner: string): Promise<ServerStatus> {
    const [docker, host, dbOk, bots] = await Promise.all([
      runtime.ping(), hostMetrics(cfg.DATA_DIR),
      db.query('SELECT 1').then(() => true, () => false), svc.list(owner),
    ]);
    const running = bots.filter((b) => b.uptimeSeconds > 0 || ['online', 'starting', 'unhealthy'].includes(b.status));
    const perBot = (await Promise.all(running.map(async (b) => {
      const s = await runtime.stats(b.id).catch(() => null);
      return s ? { botId: b.id, name: b.name, cpuPercent: Math.round(s.cpuPercent * 10) / 10, memoryBytes: s.memoryBytes, memoryLimitBytes: s.memoryLimitBytes, uptimeSeconds: b.uptimeSeconds } : null;
    }))).filter((x): x is NonNullable<typeof x> => !!x);
    return {
      status: docker.reachable && dbOk ? 'healthy' : 'degraded',
      docker: { reachable: docker.reachable, version: docker.version, error: docker.error }, database: { ok: dbOk }, host,
      runningContainers: docker.containersRunning ?? 0, backend: { version: '1.0.0', uptimeSeconds: Math.floor((Date.now() - started) / 1000) },
      totalBotUptimeSeconds: bots.reduce((a, b) => a + b.uptimeSeconds, 0), perBot,
    };
  }

  app.get('/api/server/status', pre, async (req) => status(req.userId));

  app.get('/api/dashboard', pre, async (req) => {
    const [server, bots] = await Promise.all([status(req.userId), svc.list(req.userId)]);
    const count = (f: (s: string) => boolean) => bots.filter((b) => f(b.status)).length;
    return {
      counts: { total: bots.length, max: cfg.MAX_BOTS, online: count((s) => s === 'online'), offline: count((s) => s === 'offline'), errors: count((s) => s === 'error' || s === 'unhealthy') },
      server, bots,
    };
  });

  app.get('/api/settings', pre, async (req) => {
    const rows = (await db.query('SELECT key, value FROM settings WHERE user_id=$1', [req.userId])).rows;
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { settings: { defaultMemoryMb: m.defaultMemoryMb ?? cfg.DEFAULT_BOT_MEMORY_MB, defaultCpus: m.defaultCpus ?? cfg.DEFAULT_BOT_CPUS }, limits: { maxMemoryMb: cfg.MAX_BOT_MEMORY_MB, maxCpus: cfg.MAX_BOT_CPUS } };
  });

  app.put('/api/settings', pre, async (req) => {
    const b = z.object({ defaultMemoryMb: z.number().int().min(64).max(cfg.MAX_BOT_MEMORY_MB), defaultCpus: z.number().min(0.1).max(cfg.MAX_BOT_CPUS) }).partial().strict().parse(req.body);
    for (const [k, v] of Object.entries(b)) await db.query('INSERT INTO settings(user_id, key, value) VALUES ($1,$2,$3) ON CONFLICT (user_id, key) DO UPDATE SET value=EXCLUDED.value', [req.userId, k, JSON.stringify(v)]);
    return { ok: true };
  });
}
