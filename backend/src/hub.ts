import { EventEmitter } from 'node:events';
import type { LogEntry, LogStream } from '@itzbot/shared';
import type { Db } from './db';
import { Redactor, redactGeneric } from './redact';

/** Fan-out for live logs (WebSocket) + batched persistence. All lines are redacted before leaving here. */
export class LogHub extends EventEmitter {
  private buf: LogEntry[] = [];
  private redactors = new Map<string, Redactor>();
  private timers: NodeJS.Timeout[] = [];
  constructor(private db: Db, private keep = 5000) { super(); this.setMaxListeners(0); }

  setRedactor(botId: string, r: Redactor) { this.redactors.set(botId, r); }
  forget(botId: string) { this.redactors.delete(botId); }

  publish(botId: string, stream: LogStream, line: string, ts = new Date().toISOString()) {
    const r = this.redactors.get(botId);
    const clean = (r ? r.redact(line) : redactGeneric(line)).slice(0, 4000);
    const entry: LogEntry = { botId, ts, stream, line: clean };
    this.buf.push(entry);
    this.emit('log', entry);
  }

  async flush(): Promise<void> {
    if (!this.buf.length) return;
    const b = this.buf.splice(0, this.buf.length);
    try {
      await this.db.query(
        'INSERT INTO bot_logs(bot_id, ts, stream, line) SELECT * FROM UNNEST($1::uuid[], $2::timestamptz[], $3::text[], $4::text[])',
        [b.map((e) => e.botId), b.map((e) => e.ts), b.map((e) => e.stream), b.map((e) => e.line)],
      );
    } catch { /* bot may have been deleted meanwhile (FK); drop batch */ }
  }

  async prune(): Promise<void> {
    await this.db.query(
      `DELETE FROM bot_logs l USING (
         SELECT bot_id, (SELECT id FROM bot_logs x WHERE x.bot_id = b.id ORDER BY id DESC OFFSET $1 LIMIT 1) AS cut FROM bots b
       ) c WHERE l.bot_id = c.bot_id AND c.cut IS NOT NULL AND l.id < c.cut`, [this.keep]).catch(() => undefined);
  }

  start() {
    this.timers.push(setInterval(() => void this.flush(), 1000), setInterval(() => void this.prune(), 5 * 60_000));
    this.timers.forEach((t) => t.unref());
  }
  async stop() { this.timers.forEach(clearInterval); this.timers = []; await this.flush(); }
}
