import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Ctx } from '../app';

const msg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().max(2000) }),
  z.object({ type: z.literal('subscribe'), botId: z.string().max(40) }),
  z.object({ type: z.literal('unsubscribe'), botId: z.string().max(40) }),
  z.object({ type: z.literal('ping') }),
]);

export function wsRoutes({ app, db, hub, svc }: Ctx) {
  app.get('/api/ws', { websocket: true, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, (socket: WebSocket) => {
    let userId = '';
    const subs = new Set<string>();
    const send = (o: unknown) => { if (socket.readyState === 1) socket.send(JSON.stringify(o)); };
    const authTimer = setTimeout(() => { if (!userId) socket.close(4001, 'auth timeout'); }, 10_000);
    const onLog = (e: { botId: string }) => { if (subs.has(e.botId)) send({ type: 'log', ...e }); };
    const onStatus = (e: { botId: string }) => { if (subs.has(e.botId)) send({ type: 'status', ...e }); };
    hub.on('log', onLog); hub.on('status', onStatus);
    const beat = setInterval(() => { if (socket.readyState === 1) socket.ping(); }, 30_000);

    socket.on('message', async (raw: Buffer) => {
      let m: z.infer<typeof msg>;
      try { m = msg.parse(JSON.parse(raw.toString())); } catch { return send({ type: 'error', message: 'Invalid message' }); }
      try {
        if (m.type === 'ping') return send({ type: 'pong' });
        if (m.type === 'auth') {
          const p = app.jwt.verify<{ sub: string; tv: number }>(m.token);
          const u = (await db.query('SELECT token_version FROM users WHERE id=$1', [p.sub])).rows[0];
          if (!u || u.token_version !== p.tv) throw new Error('revoked');
          userId = p.sub; return send({ type: 'ready' });
        }
        if (!userId) return socket.close(4001, 'unauthenticated');
        if (m.type === 'subscribe') { await svc.assertOwner(userId, m.botId); subs.add(m.botId); return send({ type: 'subscribed', botId: m.botId }); }
        if (m.type === 'unsubscribe') { subs.delete(m.botId); }
      } catch (e) {
        if (m.type === 'auth') return socket.close(4001, 'unauthorized');
        send({ type: 'error', message: (e as Error).message });
      }
    });
    socket.on('close', () => { clearTimeout(authTimer); clearInterval(beat); hub.off('log', onLog); hub.off('status', onStatus); });
  });
}
