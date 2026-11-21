import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { BotRuntime } from '@itzbot/worker';
import type { Config } from './config';
import type { Db } from './db';
import { AppError } from './errors';
import { LogHub } from './hub';
import { BotService } from './botService';
import { authRoutes } from './routes/auth';
import { botRoutes } from './routes/bots';
import { serverRoutes } from './routes/server';
import { wsRoutes } from './routes/ws';

declare module 'fastify' { interface FastifyRequest { userId: string } }
export interface Ctx { cfg: Config; db: Db; runtime: BotRuntime; hub: LogHub; svc: BotService; app: FastifyInstance; auth: (req: FastifyRequest, reply: FastifyReply) => Promise<void> }

export async function buildApp(deps: { cfg: Config; db: Db; runtime: BotRuntime; logger?: boolean }) {
  const { cfg, db, runtime } = deps;
  const app = Fastify({ logger: deps.logger === false ? false : { level: cfg.LOG_LEVEL, redact: ['req.headers.authorization'] }, trustProxy: cfg.TRUST_PROXY, bodyLimit: 1024 * 1024 });
  await app.register(helmet);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(jwt, { secret: cfg.JWT_SECRET, sign: { expiresIn: '30d' } });
  await app.register(multipart, { limits: { fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 600, fields: 20 } });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  app.decorateRequest('userId', '');

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') } });
    if (['ECONNREFUSED', '57P01', '08006', '08001', 'ETIMEDOUT'].includes(err.code)) return reply.code(503).send({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable. Try again shortly.' } });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.code === 'FST_FILES_LIMIT') return reply.code(413).send({ error: { code: 'UPLOAD_TOO_LARGE', message: `Upload exceeds the limit of ${cfg.MAX_UPLOAD_MB} MB.` } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: err.statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST', message: err.statusCode === 429 ? 'Too many requests. Slow down and retry shortly.' : err.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error.' } });
  });

  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const p = await req.jwtVerify<{ sub: string; tv: number }>();
      const u = (await db.query('SELECT token_version FROM users WHERE id=$1', [p.sub])).rows[0];
      if (!u || u.token_version !== p.tv) throw new Error('revoked');
      req.userId = p.sub;
    } catch (e) {
      if ((e as any)?.code === 'ECONNREFUSED') throw e;
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } });
    }
  };

  const hub = new LogHub(db);
  const svc = new BotService({ db, runtime, hub, cfg });
  const ctx: Ctx = { cfg, db, runtime, hub, svc, app, auth };
  app.get('/api/health', async () => ({ ok: true }));
  authRoutes(ctx); botRoutes(ctx); serverRoutes(ctx); wsRoutes(ctx);
  return { app, svc, hub, ctx };
}
