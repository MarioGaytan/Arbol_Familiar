import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { pool } from './db.js';

/**
 * Colaboración en vivo.
 * - Cada pestaña abre un canal SSE (Server-Sent Events) por árbol: una conexión HTTP que queda abierta
 *   y por la que el servidor "empuja" avisos.
 * - Cada cambio exitoso hace NOTIFY en PostgreSQL; este servidor (y cualquier otra copia que hubiera)
 *   escucha con LISTEN y reenvía el aviso a las pestañas abiertas de ese árbol.
 * - Las pestañas que reciben el aviso vuelven a pedir el árbol. La que hizo el cambio lo ignora.
 */

const CHANNEL = 'tree_changes';

interface Conn {
  treeId: string;
  clientId: string;
  user: { id: string; name: string };
  write: (chunk: string) => void;
}
const conns = new Set<Conn>();

const send = (c: Conn, event: string, data: unknown) => c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** Quién tiene abierto cada árbol (sin repetir usuarios con varias pestañas). */
function broadcastPresence(treeId: string) {
  const here = [...conns].filter((c) => c.treeId === treeId);
  const users = [...new Map(here.map((c) => [c.user.id, c.user])).values()];
  for (const c of here) send(c, 'presence', users);
}

async function listen(app: FastifyInstance) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  const retry = () => {
    client.removeAllListeners();
    client.end().catch(() => undefined);
    setTimeout(() => listen(app).catch(() => undefined), 3000);
  };
  client.on('error', (e) => {
    app.log.warn(e, 'tiempo real: conexión LISTEN perdida, reintentando');
    retry();
  });
  client.on('notification', (msg) => {
    if (!msg.payload) return;
    const ev = JSON.parse(msg.payload) as { treeId: string; clientId?: string; by: string; at: string };
    for (const c of conns) if (c.treeId === ev.treeId && c.clientId !== ev.clientId) send(c, 'change', ev);
  });
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
}

export async function registerRealtime(app: FastifyInstance) {
  await listen(app);

  // Tras cada cambio exitoso en un árbol, avisar a los demás
  app.addHook('onResponse', async (req, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || reply.statusCode >= 300) return;
    const treeId = (req.params as { treeId?: string } | undefined)?.treeId;
    if (!treeId || !req.user) return;
    const payload = JSON.stringify({
      treeId,
      clientId: req.headers['x-client-id'],
      by: req.user.name,
      at: new Date().toISOString(),
    });
    await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]).catch((e) => req.log.warn(e, 'pg_notify'));
  });

  // Canal de avisos (el permiso sobre el árbol ya lo verificó el hook de autorización)
  app.get('/api/trees/:treeId/events', async (req, reply) => {
    const { treeId } = req.params as { treeId: string };
    const { clientId } = z.object({ clientId: z.string().min(8).max(64) }).parse(req.query);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // que ningún proxy retenga los mensajes
    });
    const conn: Conn = { treeId, clientId, user: { id: req.user!.id, name: req.user!.name }, write: (c) => res.write(c) };
    conns.add(conn);
    res.write('retry: 3000\n\n');
    broadcastPresence(treeId);
    // Latido: evita que el proxy de Railway corte la conexión por inactividad
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      conns.delete(conn);
      broadcastPresence(treeId);
    });
  });
}
