import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BotRuntime, RuntimeState } from '@itzbot/worker';
import type { Analysis, BotStatus, BotView } from '@itzbot/shared';
import type { Config } from './config';
import type { Db } from './db';
import { decryptSecret, encryptSecret } from './crypto';
import { AppError } from './errors';
import { LogHub } from './hub';
import { Redactor, SECRET_KEY_RE } from './redact';
import { analyzeProject, stripDotEnv } from './analyze';
import { flattenSingleRoot } from './fsafe';
import { validateEnvKey, validateStartCommand } from './validation';

type Row = Record<string, any>;
const DIAG: [RegExp, (m: RegExpExecArray) => string][] = [
  [/TokenInvalid|invalid token was provided|Incorrect login details/i, () => 'Discord rejected the bot token. Replace the token in Bot Details.'],
  [/DisallowedIntents|disallowed intents/i, () => 'Required Gateway Intents are not enabled. Enable them in the Discord Developer Portal → Bot → Privileged Gateway Intents.'],
  [/Cannot find module '([^'./][^']*)'/i, (m) => `Missing dependency "${m[1]}". Add it to package.json and re-import the project.`],
  [/ENOTFOUND|EAI_AGAIN/i, () => 'The bot could not resolve a hostname (network/DNS problem).'],
];

export class BotService {
  private locks = new Map<string, Promise<unknown>>();
  private followers = new Map<string, { stop: () => void; lastTs: string }>();
  private hints = new Map<string, string>();
  private recovery = new Map<string, number>();
  private monitorTimer?: NodeJS.Timeout;

  constructor(private d: { db: Db; runtime: BotRuntime; hub: LogHub; cfg: Config }) {
    d.hub.on('log', (e: { botId: string; stream: string; line: string }) => {
      if (e.stream === 'system') return;
      for (const [re, f] of DIAG) { const m = re.exec(e.line); if (m) { this.hints.set(e.botId, f(m)); break; } }
    });
  }

  // ---------- paths / locking ----------
  botDir = (id: string) => path.join(this.d.cfg.DATA_DIR, 'bots', id);
  srcDir = (id: string) => path.join(this.botDir(id), 'src');
  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    try { return await run; } finally { if (this.locks.get(id) === tail) this.locks.delete(id); }
  }
  private async setProc(id: string, p: { desired?: string; status?: string; error?: string | null; containerId?: string | null; started?: boolean; exit?: number | null; restarts?: number }) {
    await this.d.db.query(
      `UPDATE bot_processes SET desired_state = COALESCE($2, desired_state), status = COALESCE($3, status),
         last_error = CASE WHEN $4::boolean THEN $5 ELSE last_error END, container_id = CASE WHEN $6::boolean THEN $7 ELSE container_id END,
         last_started_at = CASE WHEN $8::boolean THEN now() ELSE last_started_at END,
         last_exit_code = CASE WHEN $9::boolean THEN $10 ELSE last_exit_code END, restart_count = COALESCE($11, restart_count), updated_at = now()
       WHERE bot_id = $1`,
      [id, p.desired ?? null, p.status ?? null, p.error !== undefined, p.error ?? null, p.containerId !== undefined, p.containerId ?? null,
        !!p.started, p.exit !== undefined, p.exit ?? null, p.restarts ?? null]);
    this.d.hub.emit('status', { botId: id });
  }

  // ---------- queries ----------
  private async rows(where: string, params: unknown[]): Promise<Row[]> {
    return (await this.d.db.query(
      `SELECT b.*, c.start_command, c.entry_file, c.env_enc, c.allow_install_scripts, c.memory_mb, c.cpus,
              p.desired_state, p.status AS proc_status, p.last_error, p.last_exit_code, p.restart_count
         FROM bots b JOIN bot_configs c ON c.bot_id = b.id JOIN bot_processes p ON p.bot_id = b.id ${where} ORDER BY b.created_at`, params)).rows;
  }
  private async hasSource(id: string) { return fs.stat(this.srcDir(id)).then((s) => s.isDirectory(), () => false); }

  private derive(r: Row, st: RuntimeState | null): { status: BotStatus; error: string | null } {
    const hint = this.hints.get(r.id) ?? null;
    if (this.locks.has(r.id) && r.proc_status === 'installing') return { status: 'installing', error: null };
    if (!st) return r.desired_state === 'running' ? { status: 'error', error: r.last_error ?? 'Container is missing.' } : { status: r.proc_status === 'error' ? 'error' : 'offline', error: r.proc_status === 'error' ? r.last_error : null };
    if (st.restarting) return { status: 'restarting', error: hint ?? `Crashed (exit code ${st.exitCode ?? '?'}); Docker is restarting it.` };
    if (st.running) {
      if (st.health === 'unhealthy') return { status: 'unhealthy', error: 'Health check failing: the Node.js process is not running.' };
      return { status: st.health === 'starting' ? 'starting' : 'online', error: null };
    }
    if (r.desired_state === 'running') return { status: 'error', error: hint ?? (st.oomKilled ? 'Out of memory: raise the memory limit in Bot Details.' : `Exited with code ${st.exitCode}.`) };
    return r.proc_status === 'error' ? { status: 'error', error: r.last_error } : { status: 'offline', error: null };
  }

  private async view(r: Row): Promise<BotView> {
    const st = await this.d.runtime.inspect(r.id).catch(() => null);
    const { status, error } = this.derive(r, st);
    const env = r.env_enc ? JSON.parse(decryptSecret(r.env_enc, this.d.cfg.MASTER_KEY)) : {};
    return {
      id: r.id, name: r.name, applicationId: r.application_id, sourceType: r.source_type, sourceUrl: r.source_url,
      hasSource: await this.hasSource(r.id), hasToken: true,
      config: { startCommand: r.start_command, entryFile: r.entry_file, envKeys: Object.keys(env), memoryMb: r.memory_mb, cpus: r.cpus === null ? null : Number(r.cpus), allowInstallScripts: r.allow_install_scripts },
      status, uptimeSeconds: st?.running && st.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(st.startedAt)) / 1000)) : 0,
      restartCount: st?.restartCount ?? r.restart_count, lastExitCode: st && !st.running ? st.exitCode : r.last_exit_code,
      lastError: error ?? r.last_error ?? null, health: st?.health ?? 'none', createdAt: r.created_at,
    };
  }

  async list(owner: string): Promise<BotView[]> { return Promise.all((await this.rows('WHERE b.owner_id = $1', [owner])).map((r) => this.view(r))); }
  private async owned(owner: string, id: string): Promise<Row> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(404, 'BOT_NOT_FOUND', 'Bot not found.');
    const r = (await this.rows('WHERE b.id = $1 AND b.owner_id = $2', [id, owner]))[0];
    if (!r) throw new AppError(404, 'BOT_NOT_FOUND', 'Bot not found.');
    return r;
  }
  async get(owner: string, id: string): Promise<BotView> { return this.view(await this.owned(owner, id)); }
  async assertOwner(owner: string, id: string) { await this.owned(owner, id); }

  // ---------- create / update ----------
  async create(owner: string, i: { name: string; applicationId: string; token: string; startCommand?: string; env?: Record<string, string> }): Promise<BotView> {
    const key = this.d.cfg.MASTER_KEY;
    const sc = i.startCommand ? validateStartCommand(i.startCommand) : 'npm start';
    const env = Object.fromEntries(Object.entries(i.env ?? {}).map(([k, v]) => [validateEnvKey(k), v]));
    const id = randomUUID();
    const client = await this.d.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(7001)');
      const n = (await client.query('SELECT count(*)::int AS n FROM bots')).rows[0].n;
      if (n >= this.d.cfg.MAX_BOTS) throw new AppError(409, 'BOT_LIMIT', `Bot limit reached (${this.d.cfg.MAX_BOTS}). Delete a bot before adding another.`);
      await client.query('INSERT INTO bots(id, owner_id, name, application_id) VALUES ($1,$2,$3,$4)', [id, owner, i.name, i.applicationId]);
      await client.query('INSERT INTO bot_configs(bot_id, start_command, env_enc) VALUES ($1,$2,$3)', [id, sc, Object.keys(env).length ? encryptSecret(JSON.stringify(env), key) : null]);
      await client.query('INSERT INTO bot_credentials(bot_id, token_enc) VALUES ($1,$2)', [id, encryptSecret(i.token, key)]);
      await client.query('INSERT INTO bot_processes(bot_id) VALUES ($1)', [id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    await fs.mkdir(path.join(this.botDir(id), 'data'), { recursive: true });
    return this.get(owner, id);
  }

  async updateConfig(owner: string, id: string, p: { name?: string; startCommand?: string; entryFile?: string | null; env?: Record<string, string | null>; memoryMb?: number | null; cpus?: number | null; allowInstallScripts?: boolean }): Promise<BotView> {
    const r = await this.owned(owner, id);
    if (p.name !== undefined) await this.d.db.query('UPDATE bots SET name=$2, updated_at=now() WHERE id=$1', [id, p.name]);
    if (p.startCommand !== undefined) await this.d.db.query('UPDATE bot_configs SET start_command=$2 WHERE bot_id=$1', [id, validateStartCommand(p.startCommand)]);
    if (p.entryFile !== undefined) {
      if (p.entryFile) { const f = path.resolve(this.srcDir(id), p.entryFile); if (!f.startsWith(path.resolve(this.srcDir(id)) + path.sep)) throw new AppError(400, 'INVALID_ENTRY', 'Entry file must be inside the project.'); }
      await this.d.db.query('UPDATE bot_configs SET entry_file=$2 WHERE bot_id=$1', [id, p.entryFile]);
    }
    if (p.memoryMb !== undefined) await this.d.db.query('UPDATE bot_configs SET memory_mb=$2 WHERE bot_id=$1', [id, p.memoryMb]);
    if (p.cpus !== undefined) await this.d.db.query('UPDATE bot_configs SET cpus=$2 WHERE bot_id=$1', [id, p.cpus]);
    if (p.allowInstallScripts !== undefined) await this.d.db.query('UPDATE bot_configs SET allow_install_scripts=$2 WHERE bot_id=$1', [id, p.allowInstallScripts]);
    if (p.env) {
      const cur: Record<string, string> = r.env_enc ? JSON.parse(decryptSecret(r.env_enc, this.d.cfg.MASTER_KEY)) : {};
      for (const [k, v] of Object.entries(p.env)) { validateEnvKey(k); if (v === null) delete cur[k]; else cur[k] = v; }
      if (Object.keys(cur).length > 50) throw new AppError(400, 'INVALID_ENV', 'At most 50 environment variables are allowed.');
      await this.d.db.query('UPDATE bot_configs SET env_enc=$2 WHERE bot_id=$1', [id, Object.keys(cur).length ? encryptSecret(JSON.stringify(cur), this.d.cfg.MASTER_KEY) : null]);
    }
    await this.loadSecrets(id); // refresh redactor
    return this.get(owner, id);
  }

  async replaceToken(owner: string, id: string, token: string): Promise<void> {
    await this.owned(owner, id);
    await this.d.db.query('UPDATE bot_credentials SET token_enc=$2, updated_at=now() WHERE bot_id=$1', [id, encryptSecret(token, this.d.cfg.MASTER_KEY)]);
    this.hints.delete(id);
    await this.loadSecrets(id);
    this.d.hub.publish(id, 'system', 'Bot token was replaced. Restart the bot to use it.');
  }
  async applicationId(owner: string, id: string): Promise<string> { return (await this.owned(owner, id)).application_id; }

  private async loadSecrets(id: string) {
    const r = (await this.rows('WHERE b.id = $1', [id]))[0];
    const token = decryptSecret((await this.d.db.query('SELECT token_enc FROM bot_credentials WHERE bot_id=$1', [id])).rows[0].token_enc, this.d.cfg.MASTER_KEY);
    const env: Record<string, string> = r.env_enc ? JSON.parse(decryptSecret(r.env_enc, this.d.cfg.MASTER_KEY)) : {};
    this.d.hub.setRedactor(id, new Redactor([token, ...Object.entries(env).filter(([k]) => SECRET_KEY_RE.test(k)).map(([, v]) => v)]));
    return { token, env, row: r };
  }

  async history(owner: string, id: string, limit: number, before?: number) {
    await this.owned(owner, id);
    const rows = (await this.d.db.query(
      `SELECT id, ts, stream, line FROM bot_logs WHERE bot_id=$1 AND ($3::bigint IS NULL OR id < $3) ORDER BY id DESC LIMIT $2`, [id, limit, before ?? null])).rows;
    return rows.reverse().map((r) => ({ id: Number(r.id), botId: id, ts: new Date(r.ts).toISOString(), stream: r.stream, line: r.line }));
  }

  // ---------- lifecycle ----------
  start(owner: string, id: string) { return this.owned(owner, id).then((r) => this.withLock(id, () => this._start(r))).then(() => this.get(owner, id)); }
  stop(owner: string, id: string) { return this.owned(owner, id).then(() => this.withLock(id, () => this._stop(id))).then(() => this.get(owner, id)); }
  restart(owner: string, id: string) {
    return this.owned(owner, id).then((r) => this.withLock(id, async () => { this.d.hub.publish(id, 'system', 'Restart requested.'); await this._stop(id); await this._start(await this.owned(owner, id)); })).then(() => this.get(owner, id));
  }
  async delete(owner: string, id: string) {
    await this.owned(owner, id);
    await this.withLock(id, async () => {
      await this.detach(id); await this.d.runtime.stop(id, 10); await this.d.runtime.remove(id);
      await this.d.db.query('DELETE FROM bots WHERE id=$1', [id]);
      this.d.hub.forget(id); this.hints.delete(id);
      await fs.rm(this.botDir(id), { recursive: true, force: true });
    });
  }

  private async _start(r: Row) {
    const id = r.id;
    const st = await this.d.runtime.inspect(id);
    if (st && (st.running || st.restarting)) throw new AppError(409, 'ALREADY_RUNNING', 'This bot is already running.');
    if (!(await this.hasSource(id))) throw new AppError(400, 'NO_SOURCE', 'No source code has been imported yet. Import a ZIP, GitHub repository or files first.');
    this.hints.delete(id);
    await this.setProc(id, { desired: 'running', status: 'installing', error: null });
    this.d.hub.publish(id, 'system', 'Starting bot…');
    try {
      await this.ensureDeps(r);
      const { token, env, row } = await this.loadSecrets(id);
      const cfg = this.d.cfg;
      const defaults = await this.userDefaults(r.owner_id);
      const memoryMb = Math.min(row.memory_mb ?? defaults.memoryMb, cfg.MAX_BOT_MEMORY_MB);
      const cpus = Math.min(row.cpus === null ? defaults.cpus : Number(row.cpus), cfg.MAX_BOT_CPUS);
      const cid = await this.d.runtime.start({
        botId: id, startCommand: validateStartCommand(row.start_command), memoryMb, cpus,
        env: { TOKEN: token, BOT_TOKEN: token, CLIENT_ID: r.application_id, APPLICATION_ID: r.application_id, DISCORD_CLIENT_ID: r.application_id, ...env, DISCORD_TOKEN: token },
      });
      await this.setProc(id, { status: 'starting', containerId: cid, started: true, error: null });
      this.d.hub.publish(id, 'system', `Container started (limits: ${memoryMb} MB RAM, ${cpus} CPU, no swap, read-only filesystem).`);
      await this.attach(id, new Date(Date.now() - 1000));
      const after = await this.probe(id, this.d.cfg.START_PROBE_MS);
      if (!after || !after.running || after.restarting || after.restartCount > 0) {
        const why = this.hints.get(id) ?? `The bot exited right after starting (exit code ${after?.exitCode ?? 'unknown'}). Open the console for details.`;
        await this.detach(id); await this.d.runtime.stop(id, 2).catch(() => undefined); await this.d.runtime.remove(id).catch(() => undefined);
        throw new AppError(500, 'BOT_EXITED_EARLY', why);
      }
      await this.setProc(id, { status: 'online' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setProc(id, { desired: 'stopped', status: 'error', error: msg });
      this.d.hub.publish(id, 'system', `Start failed: ${msg}`);
      if (e instanceof AppError) throw e;
      const code = (e as { code?: string }).code;
      throw new AppError(code === 'DOCKER_UNAVAILABLE' ? 503 : 500, code ?? 'START_FAILED', msg);
    }
  }

  private async probe(id: string, ms: number): Promise<RuntimeState | null> {
    const end = Date.now() + ms; let st: RuntimeState | null = null;
    while (Date.now() < end) {
      st = await this.d.runtime.inspect(id);
      if (!st || !st.running || st.restarting) return st;
      await new Promise((r) => setTimeout(r, 500));
    }
    return st;
  }

  private async ensureDeps(r: Row) {
    const dir = this.srcDir(r.id);
    const pj = await fs.stat(path.join(dir, 'package.json')).catch(() => null);
    if (!pj) { this.d.hub.publish(r.id, 'system', 'No package.json: skipping dependency installation.'); return; }
    const marker = await fs.stat(path.join(dir, 'node_modules', '.itzbot-installed')).catch(() => null);
    if (marker && marker.mtimeMs >= pj.mtimeMs) return;
    this.d.hub.publish(r.id, 'system', 'Installing dependencies (npm install)…');
    await this.d.runtime.install({ botId: r.id, allowScripts: r.allow_install_scripts }, (l) => this.d.hub.publish(r.id, 'system', `[npm] ${l}`));
    await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(dir, 'node_modules', '.itzbot-installed'), new Date().toISOString());
    this.d.hub.publish(r.id, 'system', 'Dependencies installed.');
  }

  private async userDefaults(owner: string) {
    const rows = (await this.d.db.query(`SELECT key, value FROM settings WHERE user_id=$1 AND key IN ('defaultMemoryMb','defaultCpus')`, [owner])).rows;
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { memoryMb: Number(m.defaultMemoryMb ?? this.d.cfg.DEFAULT_BOT_MEMORY_MB), cpus: Number(m.defaultCpus ?? this.d.cfg.DEFAULT_BOT_CPUS) };
  }

  private async _stop(id: string) {
    this.d.hub.publish(id, 'system', 'Stopping bot (SIGTERM, up to 20 s grace period)…');
    await this.setProc(id, { desired: 'stopped' });
    try { await this.d.runtime.stop(id, 20); }
    catch (e) { const m = (e as Error).message; await this.setProc(id, { status: 'error', error: m }); throw new AppError(503, 'STOP_FAILED', m); }
    const st = await this.d.runtime.inspect(id);
    await this.detach(id);
    await this.setProc(id, { status: 'offline', error: null, exit: st?.exitCode ?? null });
    this.d.hub.publish(id, 'system', `Bot stopped${st?.exitCode !== null && st?.exitCode !== undefined ? ` (exit code ${st.exitCode})` : ''}.`);
  }

  // ---------- log following ----------
  private async attach(id: string, since: Date) {
    if (this.followers.has(id)) return;
    await this.loadSecrets(id).catch(() => undefined);
    const entry = { stop: () => undefined, lastTs: '' } as { stop: () => void; lastTs: string };
    this.followers.set(id, entry);
    try {
      entry.stop = await this.d.runtime.followLogs(id, since, (l) => {
        if (entry.lastTs && l.ts <= entry.lastTs) return; // de-duplicate on reconnect
        entry.lastTs = l.ts; this.d.hub.publish(id, l.stream, l.line, l.ts);
      }, () => { if (this.followers.get(id) === entry) this.followers.delete(id); });
    } catch { this.followers.delete(id); }
  }
  private async detach(id: string) { const f = this.followers.get(id); if (f) { f.stop(); this.followers.delete(id); } }

  // ---------- GitHub/ZIP/manual source installation ----------
  async installSource(owner: string, id: string, method: 'zip' | 'github' | 'manual', source: string, fill: (staging: string) => Promise<void>): Promise<{ analysis: Analysis; appliedDefaults: boolean }> {
    const r = await this.owned(owner, id);
    return this.withLock(id, async () => {
      const st = await this.d.runtime.inspect(id);
      if (st && (st.running || st.restarting)) throw new AppError(409, 'STOP_BOT_FIRST', 'Stop the bot before importing new files.');
      const staging = path.join(this.botDir(id), `staging-${randomUUID()}`);
      const hist = async (status: 'success' | 'failed', detail: unknown, error?: string) => {
        await this.d.db.query('INSERT INTO import_history(bot_id, user_id, method, source, status, detail, error) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, owner, method, source.slice(0, 300), status, detail ? JSON.stringify(detail) : null, error ?? null]).catch(() => undefined);
      };
      try {
        await fs.mkdir(staging, { recursive: true });
        await fill(staging);
        await flattenSingleRoot(staging);
        const envKeys = await stripDotEnv(staging);
        const analysis = await analyzeProject(staging, envKeys);
        await fs.rm(this.srcDir(id), { recursive: true, force: true });
        await fs.rename(staging, this.srcDir(id));
        await fs.mkdir(path.join(this.botDir(id), 'data'), { recursive: true });
        const first = r.source_type === null;
        await this.d.db.query('UPDATE bots SET source_type=$2, source_url=$3, updated_at=now() WHERE id=$1', [id, method, method === 'github' ? source : null]);
        if (first) await this.d.db.query('UPDATE bot_configs SET entry_file=$2, start_command=COALESCE($3, start_command) WHERE bot_id=$1', [id, analysis.suggestedEntry, analysis.suggestedStartCommand]);
        await hist('success', { files: analysis.fileCount, entry: analysis.suggestedEntry, lib: analysis.discordLib });
        return { analysis, appliedDefaults: first };
      } catch (e) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        await hist('failed', null, e instanceof Error ? e.message : String(e));
        throw e;
      }
    });
  }
  async analysis(owner: string, id: string): Promise<Analysis> {
    await this.owned(owner, id);
    if (!(await this.hasSource(id))) throw new AppError(400, 'NO_SOURCE', 'No source code has been imported yet.');
    return analyzeProject(this.srcDir(id));
  }
  async importHistory(owner: string) {
    return (await this.d.db.query('SELECT id, bot_id, method, source, status, error, created_at FROM import_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [owner])).rows;
  }

  // ---------- monitor / recovery ----------
  startMonitor(everyMs = 10_000) {
    const run = () => void this.tick().catch(() => undefined);
    run(); this.monitorTimer = setInterval(run, everyMs); this.monitorTimer.unref();
  }
  async stopMonitor() { if (this.monitorTimer) clearInterval(this.monitorTimer); for (const [id] of this.followers) await this.detach(id); }

  /** Reconciles desired vs. actual state: recovers bots after a server/Docker restart, tracks crashes, re-attaches log streams. */
  async tick() {
    const rows = await this.rows(`WHERE p.desired_state = 'running'`, []);
    await Promise.all(rows.map(async (r) => {
      const id = r.id;
      if (this.locks.has(id)) return;
      const st = await this.d.runtime.inspect(id).catch(() => undefined);
      if (st === undefined) return; // Docker unreachable: try again next tick
      if (!st) {
        const n = this.recovery.get(id) ?? 0;
        if (n >= 3) { await this.setProc(id, { desired: 'stopped', status: 'error', error: 'Automatic recovery failed 3 times. Start the bot manually after checking the console.' }); this.recovery.delete(id); return; }
        this.recovery.set(id, n + 1);
        this.d.hub.publish(id, 'system', `Container missing: recovering (attempt ${n + 1}/3)…`);
        await this.withLock(id, () => this._start(r)).catch(() => undefined);
        return;
      }
      this.recovery.delete(id);
      if (st.restartCount > r.restart_count) this.d.hub.publish(id, 'system', `Bot crashed and was restarted automatically (restart #${st.restartCount}).`);
      const { status } = this.derive(r, st);
      if (status !== r.proc_status || st.restartCount !== r.restart_count) await this.setProc(id, { status, restarts: st.restartCount, exit: st.running ? undefined : st.exitCode });
      if (st.running && !this.followers.has(id)) {
        const last = (await this.d.db.query('SELECT max(ts) AS ts FROM bot_logs WHERE bot_id=$1', [id])).rows[0].ts as Date | null;
        await this.attach(id, last ?? new Date(Date.now() - 60_000));
      }
    }));
  }
}
