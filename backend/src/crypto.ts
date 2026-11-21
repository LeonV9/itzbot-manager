import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

/** AES-256-GCM. Output format: v1:<iv>:<tag>:<ciphertext> (all base64). */
export function encryptSecret(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(blob: string, keyHex: string): string {
  const [v, iv, tag, ct] = blob.split(':');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

const N = 32768, R = 8, P = 1;
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scryptAsync(pw, salt, 64, { N, r: R, p: P, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scryptAsync(pw, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: 128 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}
