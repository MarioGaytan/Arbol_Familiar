import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { pool } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    treeRole: 'owner' | 'editor' | null;
  }
  interface FastifyContextConfig {
    /** Sólo el dueño del árbol puede usar esta ruta */
    ownerOnly?: boolean;
  }
}

/** Formato: scrypt$N$r$p$sal$hash (todo lo necesario para verificar, aunque cambien los parámetros). */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(expected, got);
}

/** Hash ficticio para que un correo inexistente tarde lo mismo que uno real (evita enumerar cuentas). */
export const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export async function createSession(reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await pool.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), userId, expires]);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function userFromRequest(req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await pool.query<SessionUser>(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function treeRole(userId: string, treeId: string): Promise<'owner' | 'editor' | null> {
  const { rows } = await pool.query<{ role: 'owner' | 'editor' }>(
    'SELECT role FROM tree_members WHERE tree_id = $1 AND user_id = $2',
    [treeId, userId],
  );
  return rows[0]?.role ?? null;
}

/** Al registrarse: las invitaciones pendientes a ese correo se convierten en acceso. */
export async function claimInvites(c: pg.PoolClient, userId: string, email: string) {
  await c.query(
    `INSERT INTO tree_members(tree_id, user_id, role)
     SELECT tree_id, $1, role FROM tree_invites WHERE email = $2
     ON CONFLICT DO NOTHING`,
    [userId, email],
  );
  await c.query('DELETE FROM tree_invites WHERE email = $1', [email]);
}

export const newPublicToken = () => randomBytes(18).toString('base64url');
