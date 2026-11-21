import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';

export type Db = Pool;
export const createDb = (url: string): Db => new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });

export async function migrate(db: Db, dir = path.resolve(__dirname, '../migrations')): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
  const applied: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (e) { await client.query('ROLLBACK'); throw new Error(`Migration ${file} failed: ${(e as Error).message}`); }
    finally { client.release(); }
  }
  return applied;
}
