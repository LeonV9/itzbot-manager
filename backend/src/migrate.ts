import { loadConfig } from './config';
import { createDb, migrate } from './db';

(async () => {
  const db = createDb(loadConfig().DATABASE_URL);
  console.log('Applied migrations:', await migrate(db));
  await db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
