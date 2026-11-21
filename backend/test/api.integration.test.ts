// INTEGRATION test against a REAL PostgreSQL database (set TEST_DATABASE_URL to a throw-away database: it is WIPED).
// Docker is replaced by FakeRuntime and GitHub by a stubbed fetch, so those parts are MOCKED, not real.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { decryptSecret, hashPassword } from '../src/crypto';
import { createDb, migrate } from '../src/db';
import { FakeRuntime } from './helpers/fakeRuntime';
import { makeZip, multipart } from './helpers/zip';

const URL = process.env.TEST_DATABASE_URL;
const MASTER = randomBytes(32).toString('hex');
const TOKEN = 'TEST_DISCORD_TOKEN_PLACEHOLDER';
const APP_ID = '123456789012345678';

describe.skipIf(!URL)('API (real PostgreSQL, fake Docker)', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>; let rt: FakeRuntime; let db: ReturnType<typeof createDb>; let dir: string; let jwt = '';
  const call = (method: string, url: string, body?: unknown, token = jwt) =>
    ctx.app.inject({ method: method as any, url, payload: body as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const mkBot = async (n = 'Bot') => (await call('POST', '/api/bots', { name: n, applicationId: APP_ID, token: TOKEN })).json().bot;
  const goodZip = () => makeZip([{ name: 'repo/package.json', data: JSON.stringify({ main: 'index.js', dependencies: { 'discord.js': '^14.0.0' } }) }, { name: 'repo/index.js', data: 'console.log(1)' }]);
  const upload = (id: string, buf: Buffer) => { const m = multipart([{ name: 'file', filename: 'bot.zip', data: buf }]); return ctx.app.inject({ method: 'POST', url: `/api/bots/${id}/import/zip`, payload: m.payload, headers: { ...m.headers, authorization: `Bearer ${jwt}` } }); };

  beforeAll(async () => {
    db = createDb(URL!);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'itz-api-'));
    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: URL!, JWT_SECRET: 'x'.repeat(40), MASTER_KEY: MASTER, DATA_DIR: dir, SKIP_DISCORD_VALIDATION: 'true', START_PROBE_MS: '100', MAX_BOTS: '10' } as any);
    rt = new FakeRuntime();
    ctx = await buildApp({ cfg, db, runtime: rt, logger: false }); ctx.hub.start();
    await ctx.app.ready();
  });
  afterAll(async () => { await ctx.svc.stopMonitor(); await ctx.hub.stop(); await ctx.app.close(); await db.end(); await fs.rm(dir, { recursive: true, force: true }); });

  describe('authentication & API security', () => {
    it('rejects unauthenticated requests', async () => { expect((await call('GET', '/api/bots', undefined, '')).statusCode).toBe(401); expect((await call('GET', '/api/bots', undefined, 'garbage')).statusCode).toBe(401); });
    it('health endpoint is public and minimal', async () => expect((await call('GET', '/api/health', undefined, '')).json()).toEqual({ ok: true }));
    it('validates registration input', async () => expect((await call('POST', '/api/auth/register', { username: 'a', password: 'short' }, '')).statusCode).toBe(400));
    it('registers the owner, then closes registration', async () => {
      const r = await call('POST', '/api/auth/register', { username: 'Owner', password: 'a-very-long-password' }, '');
      expect(r.statusCode).toBe(201); jwt = r.json().token;
      const again = await call('POST', '/api/auth/register', { username: 'other', password: 'another-long-password' }, '');
      expect(again.statusCode).toBe(403);
      const hash = (await db.query('SELECT password_hash FROM users')).rows[0].password_hash;
      expect(hash).not.toContain('a-very-long-password');
    });
    it('logs in, rejects wrong password', async () => {
      expect((await call('POST', '/api/auth/login', { username: 'owner', password: 'a-very-long-password' }, '')).statusCode).toBe(200);
      expect((await call('POST', '/api/auth/login', { username: 'owner', password: 'nope-nope-nope' }, '')).statusCode).toBe(401);
    });
    it('changing the password revokes old tokens', async () => {
      const r = await call('POST', '/api/auth/change-password', { currentPassword: 'a-very-long-password', newPassword: 'a-new-long-password' });
      expect(r.statusCode).toBe(200); expect((await call('GET', '/api/auth/me')).statusCode).toBe(401);
      jwt = r.json().token; expect((await call('GET', '/api/auth/me')).statusCode).toBe(200);
    });
    it('rate-limits login attempts', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 13; i++) codes.push((await call('POST', '/api/auth/login', { username: 'owner', password: 'wrong-wrong-wrong' }, '')).statusCode);
      expect(codes).toContain(429);
    });
  });

  describe('bots, secrets & configuration', () => {
    let id: string;
    it('rejects a bot token passed as Application ID', async () => expect((await call('POST', '/api/bots', { name: 'x', applicationId: TOKEN, token: TOKEN })).statusCode).toBe(400));
    it('creates a bot; token is encrypted at rest and never returned', async () => {
      const r = await call('POST', '/api/bots', { name: 'Alpha', applicationId: APP_ID, token: TOKEN, env: { GUILD_ID: '42', API_KEY: 'sekret-value-1' } });
      expect(r.statusCode).toBe(201); id = r.json().bot.id;
      expect(r.body).not.toContain(TOKEN); expect(r.body).not.toContain('sekret-value-1');
      const row = (await db.query('SELECT token_enc FROM bot_credentials WHERE bot_id=$1', [id])).rows[0];
      expect(row.token_enc).not.toContain(TOKEN); expect(decryptSecret(row.token_enc, MASTER)).toBe(TOKEN);
      const got = (await call('GET', `/api/bots/${id}`)); expect(got.body).not.toContain(TOKEN); expect(got.json().bot.config.envKeys.sort()).toEqual(['API_KEY', 'GUILD_ID']);
    });
    it('updates configuration and validates the start command', async () => {
      expect((await call('PATCH', `/api/bots/${id}`, { startCommand: 'node index.js', name: 'Alpha2' })).json().bot.config.startCommand).toBe('node index.js');
      expect((await call('PATCH', `/api/bots/${id}`, { startCommand: 'rm -rf /' })).statusCode).toBe(400);
      expect((await call('PATCH', `/api/bots/${id}`, { env: { GUILD_ID: null } })).json().bot.config.envKeys).toEqual(['API_KEY']);
    });
    it('replaces the token without revealing the old one', async () => {
      const t2 = TOKEN.replace('GabcDe', 'ZZZZZZ'); const r = await call('PUT', `/api/bots/${id}/token`, { token: t2 });
      expect(r.statusCode).toBe(200); expect(r.body).not.toContain(TOKEN);
      expect(decryptSecret((await db.query('SELECT token_enc FROM bot_credentials WHERE bot_id=$1', [id])).rows[0].token_enc, MASTER)).toBe(t2);
    });
    it("hides other users' bots", async () => {
      await db.query('INSERT INTO users(username, password_hash) VALUES ($1,$2)', ['intruder', await hashPassword('intruder-password')]);
      const u = (await db.query(`SELECT id, token_version FROM users WHERE username='intruder'`)).rows[0];
      const t = ctx.app.jwt.sign({ sub: u.id, tv: u.token_version });
      expect((await call('GET', `/api/bots/${id}`, undefined, t)).statusCode).toBe(404);
      expect((await call('POST', `/api/bots/${id}/start`, undefined, t)).statusCode).toBe(404);
      expect((await call('DELETE', `/api/bots/${id}`, undefined, t)).statusCode).toBe(404);
    });

    describe('import', () => {
      it('start without source gives a helpful error', async () => { const r = await call('POST', `/api/bots/${id}/start`); expect(r.statusCode).toBe(400); expect(r.json().error.code).toBe('NO_SOURCE'); });
      it('rejects a malicious ZIP and records the failure', async () => {
        const r = await upload(id, makeZip([{ name: '../../evil.js', data: 'x' }]));
        expect(r.statusCode).toBe(400); expect(r.json().error.code).toBe('ZIP_PATH_TRAVERSAL');
        expect((await db.query(`SELECT count(*)::int n FROM import_history WHERE status='failed'`)).rows[0].n).toBeGreaterThan(0);
        expect(await fs.stat(path.join(dir, 'evil.js')).then(() => true, () => false)).toBe(false);
      });
      it('imports a valid ZIP and detects discord.js + entry', async () => {
        const r = await upload(id, goodZip()); expect(r.statusCode).toBe(200);
        expect(r.json().analysis.discordLib.name).toBe('discord.js'); expect(r.json().analysis.suggestedEntry).toBe('index.js');
        expect((await call('GET', `/api/bots/${id}`)).json().bot.hasSource).toBe(true);
      });
      it('imports from GitHub (MOCKED GitHub: fetch is stubbed)', async () => {
        const zip = goodZip();
        vi.stubGlobal('fetch', vi.fn(async () => new Response(zip, { status: 200 })));
        const r = await call('POST', `/api/bots/${id}/import/github`, { url: 'https://github.com/me/bot' });
        vi.unstubAllGlobals(); expect(r.statusCode).toBe(200); expect(r.json().analysis.hasPackageJson).toBe(true);
      });
      it('reports GitHub not found clearly (MOCKED)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
        const r = await call('POST', `/api/bots/${id}/import/github`, { url: 'https://github.com/me/missing' });
        vi.unstubAllGlobals(); expect(r.statusCode).toBe(404); expect(r.json().error.code).toBe('GITHUB_NOT_FOUND');
      });
      it('imports manually uploaded files', async () => {
        const m = multipart([{ name: 'f', filename: 'package.json', data: '{"main":"bot.js","dependencies":{"discord.js":"14"}}' }, { name: 'f', filename: 'bot.js', data: '//' }]);
        const r = await ctx.app.inject({ method: 'POST', url: `/api/bots/${id}/import/manual`, payload: m.payload, headers: { ...m.headers, authorization: `Bearer ${jwt}` } });
        expect(r.statusCode).toBe(200); expect(r.json().analysis.suggestedEntry).toBe('bot.js');
      });
      it('re-import keeps the user\'s start command', async () => {
        await call('PATCH', `/api/bots/${id}`, { startCommand: 'node custom.js' }); await upload(id, goodZip());
        expect((await call('GET', `/api/bots/${id}`)).json().bot.config.startCommand).toBe('node custom.js');
      });
    });

    describe('process management (fake Docker)', () => {
      it('starts, injects token env, prevents duplicate start, stops', async () => {
        await call('PATCH', `/api/bots/${id}`, { startCommand: 'node index.js' });
        const s = await call('POST', `/api/bots/${id}/start`); expect(s.statusCode).toBe(200); expect(s.json().bot.status).toMatch(/online|starting/);
        expect(rt.containers.get(id)!.spec.env.DISCORD_TOKEN).toContain('ZZZZZZ');
        expect(rt.installs).toContain(id);
        const dup = await call('POST', `/api/bots/${id}/start`); expect(dup.statusCode).toBe(409); expect(dup.json().error.code).toBe('ALREADY_RUNNING');
        expect((await call('POST', `/api/bots/${id}/import/zip`)).statusCode).not.toBe(200);
        const st = await call('POST', `/api/bots/${id}/stop`); expect(st.json().bot.status).toBe('offline');
      });
      it('concurrent starts create exactly one container', async () => {
        const rs = await Promise.all([call('POST', `/api/bots/${id}/start`), call('POST', `/api/bots/${id}/start`), call('POST', `/api/bots/${id}/start`)]);
        expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
      });
      it('restarts', async () => { const r = await call('POST', `/api/bots/${id}/restart`); expect(r.statusCode).toBe(200); expect(r.json().bot.status).toMatch(/online|starting/); });
      it('applies per-bot resource limits', async () => {
        await call('PATCH', `/api/bots/${id}`, { memoryMb: 128, cpus: 0.25 }); await call('POST', `/api/bots/${id}/restart`);
        expect(rt.containers.get(id)!.spec).toMatchObject({ memoryMb: 128, cpus: 0.25 });
        expect((await call('PATCH', `/api/bots/${id}`, { memoryMb: 99999 })).statusCode).toBe(400);
      });
      it('recovers a missing container for a bot that should be running (reboot recovery)', async () => {
        rt.containers.delete(id); await ctx.svc.tick();
        expect(rt.containers.get(id)?.running).toBe(true);
      });
      it('streams logs over WebSocket (auth required) and persists them', async () => {
        await ctx.app.listen({ port: 0, host: '127.0.0.1' });
        const port = (ctx.app.server.address() as any).port; const got: any[] = [];
        const bad = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
        const closed = new Promise<number>((res) => bad.on('close', (c) => res(c)));
        bad.on('open', () => bad.send(JSON.stringify({ type: 'auth', token: 'nope' })));
        expect(await closed).toBe(4001);
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
        await new Promise<void>((res) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'auth', token: jwt })); ws.send(JSON.stringify({ type: 'subscribe', botId: id })); res(); }));
        ws.on('message', (m) => got.push(JSON.parse(m.toString())));
        await new Promise((r) => setTimeout(r, 200));
        await call('POST', `/api/bots/${id}/stop`);
        await new Promise((r) => setTimeout(r, 300)); ws.close();
        expect(got.some((m) => m.type === 'log' && m.stream === 'system' && /stopp/i.test(m.line))).toBe(true);
        await ctx.hub.flush();
        const h = await call('GET', `/api/bots/${id}/logs`); expect(h.json().logs.length).toBeGreaterThan(3);
        expect(h.body).not.toContain(TOKEN);
      });
    });

    it('deletes a bot, its container, files and rows', async () => {
      await call('POST', `/api/bots/${id}/start`);
      expect((await call('DELETE', `/api/bots/${id}`)).statusCode).toBe(200);
      expect(rt.containers.has(id)).toBe(false);
      expect(await fs.stat(path.join(dir, 'bots', id)).then(() => true, () => false)).toBe(false);
      for (const t of ['bots', 'bot_configs', 'bot_credentials', 'bot_processes']) expect((await db.query(`SELECT count(*)::int n FROM ${t} WHERE ${t === 'bots' ? 'id' : 'bot_id'}=$1`, [id])).rows[0].n).toBe(0);
    });
  });

  describe('capacity, dashboard, settings', () => {
    it('enforces the 10-bot limit', async () => {
      const have = (await call('GET', '/api/bots')).json().bots.length;
      for (let i = have; i < 10; i++) expect((await call('POST', '/api/bots', { name: `B${i}`, applicationId: APP_ID, token: TOKEN })).statusCode).toBe(201);
      const r = await call('POST', '/api/bots', { name: 'eleven', applicationId: APP_ID, token: TOKEN }); expect(r.statusCode).toBe(409); expect(r.json().error.code).toBe('BOT_LIMIT');
    });
    it('dashboard returns real counts and metrics', async () => {
      const d = (await call('GET', '/api/dashboard')).json();
      expect(d.counts.total).toBe(10); expect(d.server.host.memTotalBytes).toBeGreaterThan(0); expect(d.server.docker.reachable).toBe(true); expect(d.server.database.ok).toBe(true);
    });
    it('stores validated settings', async () => {
      expect((await call('PUT', '/api/settings', { defaultMemoryMb: 192, defaultCpus: 0.4 })).statusCode).toBe(200);
      expect((await call('GET', '/api/settings')).json().settings.defaultMemoryMb).toBe(192);
      expect((await call('PUT', '/api/settings', { defaultMemoryMb: 1 })).statusCode).toBe(400);
    });
  });
});
