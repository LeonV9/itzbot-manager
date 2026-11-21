import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from '../src/crypto';

const key = randomBytes(32).toString('hex');
describe('secret encryption (real crypto, no mocks)', () => {
  it('round-trips and never stores plaintext', () => {
    const blob = encryptSecret('super-secret-token', key);
    expect(blob).not.toContain('super-secret-token');
    expect(decryptSecret(blob, key)).toBe('super-secret-token');
  });
  it('uses a fresh IV every time', () => expect(encryptSecret('a', key)).not.toBe(encryptSecret('a', key)));
  it('detects tampering and wrong keys', () => {
    const blob = encryptSecret('x', key); const parts = blob.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
    expect(() => decryptSecret(blob, randomBytes(32).toString('hex'))).toThrow();
  });
});
describe('password hashing', () => {
  it('verifies correct and rejects wrong passwords', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong password!!', h)).toBe(false);
  });
});
