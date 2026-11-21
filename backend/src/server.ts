import Docker from 'dockerode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DockerRuntime } from '@itzbot/worker';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb, migrate } from './db';

async function main() {
  const cfg = loadConfig();
  const db = createDb(cfg.DATABASE_URL);
  console.log('Applied migrations:', await migrate(db));
  await db.query(`INSERT INTO hosting_servers(name, kind) SELECT 'Local Docker host', 'local' WHERE NOT EXISTS (SELECT 1 FROM hosting_servers)`);
  await fs.mkdir(path.join(cfg.DATA_DIR, 'bots'), { recursive: true });

  const docker = cfg.DOCKER_SOCKET ? new Docker({ socketPath: cfg.DOCKER_SOCKET }) : new Docker({ host: cfg.DOCKER_HOST_ADDR, port: cfg.DOCKER_PORT, protocol: 'http' });
  const runtime = new DockerRuntime({ docker, image: cfg.BOT_IMAGE, hostDataDir: cfg.HOST_DATA_DIR, network: cfg.BOT_NETWORK, pids: cfg.BOT_PIDS_LIMIT });
  const { app, svc, hub } = await buildApp({ cfg, db, runtime });
  hub.start();

  // Docker may be briefly unavailable at boot; keep retrying in the background instead of crashing.
  (async () => { for (;;) { try { await runtime.prepare(); app.log.info('Docker ready'); break; } catch (e) { app.log.warn(`Docker not ready: ${(e as Error).message}`); await new Promise((r) => setTimeout(r, 5000)); } } })();
  svc.startMonitor();

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  const shutdown = async (sig: string) => {
    app.log.info(`${sig}: shutting down (bot containers keep running)`);
    await svc.stopMonitor(); await app.close(); await hub.stop(); await db.end(); process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
