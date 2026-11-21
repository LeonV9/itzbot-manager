import { z } from 'zod';

const bool = (d: 'true' | 'false') => z.enum(['true', 'false']).default(d).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  MASTER_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEY must be 64 hex characters (openssl rand -hex 32)'),
  DATA_DIR: z.string().default('/data'),
  HOST_DATA_DIR: z.string().optional(),
  DOCKER_HOST_ADDR: z.string().default('docker-proxy'),
  DOCKER_PORT: z.coerce.number().default(2375),
  DOCKER_SOCKET: z.string().optional(),
  BOT_IMAGE: z.string().default('node:20-alpine'),
  BOT_NETWORK: z.string().default('itzbot-bots'),
  BOT_PIDS_LIMIT: z.coerce.number().default(128),
  MAX_BOTS: z.coerce.number().default(10),
  DEFAULT_BOT_MEMORY_MB: z.coerce.number().default(256),
  DEFAULT_BOT_CPUS: z.coerce.number().default(0.5),
  MAX_BOT_MEMORY_MB: z.coerce.number().default(1024),
  MAX_BOT_CPUS: z.coerce.number().default(2),
  MAX_UPLOAD_MB: z.coerce.number().default(100),
  ALLOW_REGISTRATION: bool('false'),
  TRUST_PROXY: bool('true'),
  SKIP_DISCORD_VALIDATION: bool('false'),
  START_PROBE_MS: z.coerce.number().default(6000),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema> & { HOST_DATA_DIR: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error('Invalid configuration:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  const c = parsed.data;
  if (c.SKIP_DISCORD_VALIDATION && c.NODE_ENV === 'production') throw new Error('SKIP_DISCORD_VALIDATION must not be enabled in production.');
  return { ...c, HOST_DATA_DIR: c.HOST_DATA_DIR ?? c.DATA_DIR };
}
