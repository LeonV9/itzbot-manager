import { z } from 'zod';
import type { Ctx } from '../app';
import { hashPassword, verifyPassword } from '../crypto';
import { AppError } from '../errors';

const username = z.string().regex(/^[a-zA-Z0-9_.-]{3,32}$/, '3–32 characters: letters, digits, _ . -');
const password = z.string().min(10, 'at least 10 characters').max(128);
const tight = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export function authRoutes(ctx: Ctx) {
  const { app, db, auth, cfg } = ctx;
  const issue = (u: { id: string; token_version: number }) => app.jwt.sign({ sub: u.id, tv: u.token_version });

  app.post('/api/auth/register', tight, async (req, reply) => {
    const b = z.object({ username, password }).parse(req.body);
    const count = (await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    if (count > 0 && !cfg.ALLOW_REGISTRATION) throw new AppError(403, 'REGISTRATION_CLOSED', 'Registration is closed. The owner account already exists.');
    try {
      const u = (await db.query('INSERT INTO users(username, password_hash) VALUES ($1,$2) RETURNING id, username, token_version', [b.username.toLowerCase(), await hashPassword(b.password)])).rows[0];
      return reply.code(201).send({ token: issue(u), user: { id: u.id, username: u.username } });
    } catch (e: any) { if (e.code === '23505') throw new AppError(409, 'USERNAME_TAKEN', 'That username is taken.'); throw e; }
  });

  app.post('/api/auth/login', tight, async (req) => {
    const b = z.object({ username: z.string().max(64), password: z.string().max(128) }).parse(req.body);
    const u = (await db.query('SELECT * FROM users WHERE username=$1', [b.username.toLowerCase()])).rows[0];
    const ok = u ? await verifyPassword(b.password, u.password_hash) : await verifyPassword(b.password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==').then(() => false);
    if (!u || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password.');
    return { token: issue(u), user: { id: u.id, username: u.username } };
  });

  app.get('/api/auth/me', { preHandler: auth }, async (req) => {
    const u = (await db.query('SELECT id, username, created_at FROM users WHERE id=$1', [req.userId])).rows[0];
    return { user: u };
  });

  app.post('/api/auth/change-password', { preHandler: auth, ...tight }, async (req) => {
    const b = z.object({ currentPassword: z.string().max(128), newPassword: password }).parse(req.body);
    const u = (await db.query('SELECT * FROM users WHERE id=$1', [req.userId])).rows[0];
    if (!(await verifyPassword(b.currentPassword, u.password_hash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    const n = (await db.query('UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING id, token_version', [req.userId, await hashPassword(b.newPassword)])).rows[0];
    return { token: issue(n) };
  });

  app.post('/api/auth/logout-all', { preHandler: auth }, async (req) => {
    await db.query('UPDATE users SET token_version=token_version+1 WHERE id=$1', [req.userId]);
    return { ok: true };
  });
}
