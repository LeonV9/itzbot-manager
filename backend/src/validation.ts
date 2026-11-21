import { AppError } from './errors';

const SEGMENT = /^(node|npm|npx|yarn|pnpm)(\s+[A-Za-z0-9_@.\/:=\-]+)*$/;
export function validateStartCommand(cmd: string): string {
  const c = cmd.trim();
  if (!c || c.length > 200) throw new AppError(400, 'INVALID_START_COMMAND', 'Start command must be 1–200 characters.');
  const segs = c.split('&&').map((s) => s.trim());
  if (segs.length > 3 || !segs.every((s) => SEGMENT.test(s))) {
    throw new AppError(400, 'INVALID_START_COMMAND',
      'Start command must be made of node/npm/npx/yarn/pnpm commands (optionally chained with &&), e.g. "npm start" or "node index.js". Shell syntax such as ; | > $() is not allowed.');
  }
  return c;
}

const RESERVED = new Set(['PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'HOME', 'NODE_OPTIONS', 'DISCORD_TOKEN']);
export function validateEnvKey(k: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) throw new AppError(400, 'INVALID_ENV', `Invalid environment variable name "${k}".`);
  if (RESERVED.has(k.toUpperCase())) throw new AppError(400, 'INVALID_ENV', `"${k}" is reserved and managed by the platform.`);
  return k;
}

export const isApplicationId = (s: string) => /^\d{17,20}$/.test(s);
