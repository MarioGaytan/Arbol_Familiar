import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from './db.js';
import {
  claimInvites, createSession, destroySession, DUMMY_HASH, hashPassword, newPublicToken, treeRole,
  userFromRequest, verifyPassword,
} from './auth.js';

const email = z.string().trim().toLowerCase().email('Correo inválido').max(200);
const uuid = z.string().uuid();

/** Rutas que no requieren sesión */
const PUBLIC_PREFIXES = ['/api/health', '/api/auth/', '/api/public/'];

export async function registerAccountRoutes(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('treeRole', null);

  // ---------- Autenticación y autorización para TODA la API ----------
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = await userFromRequest(req);
    if (PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;
    if (!req.user) return reply.code(401).send({ error: 'Inicia sesión para continuar' });

    // Toda ruta /api/trees/:treeId/... exige ser miembro del árbol
    const treeId = (req.params as { treeId?: string } | undefined)?.treeId;
    if (treeId) {
      if (!uuid.safeParse(treeId).success) return reply.code(404).send({ error: 'Árbol no encontrado' });
      req.treeRole = await treeRole(req.user.id, treeId);
      // 404 y no 403: a quien no tiene acceso ni siquiera se le confirma que el árbol existe
      if (!req.treeRole) return reply.code(404).send({ error: 'Árbol no encontrado' });
      if (req.routeOptions.config.ownerOnly && req.treeRole !== 'owner') {
        return reply.code(403).send({ error: 'Sólo el dueño del árbol puede hacer esto' });
      }
    }
  });

  // ---------- Cuentas ----------
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

  app.post('/api/auth/register', authLimit, async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1, 'Escribe tu nombre').max(120),
        email,
        password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
      })
      .parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const user = await tx(async (c) => {
      const exists = await c.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
      if (exists.rowCount) throw Object.assign(new Error('Ya existe una cuenta con ese correo'), { statusCode: 409 });
      const { rows } = await c.query(
        'INSERT INTO users(name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
        [body.name, body.email, passwordHash],
      );
      const u = rows[0];
      await claimInvites(c, u.id, body.email);
      // Primer usuario de la instalación: se queda con los árboles creados antes de existir cuentas
      const { rows: cnt } = await c.query('SELECT count(*)::int AS n FROM users');
      if (cnt[0].n === 1) {
        await c.query(
          `INSERT INTO tree_members(tree_id, user_id, role)
           SELECT t.id, $1, 'owner' FROM trees t
            WHERE NOT EXISTS (SELECT 1 FROM tree_members m WHERE m.tree_id = t.id)`,
          [u.id],
        );
      }
      return u;
    });
    await createSession(reply, user.id);
    return { user };
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const body = z.object({ email, password: z.string().max(200) }).parse(req.body);
    const { rows } = await pool.query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [body.email]);
    const u = rows[0];
    const ok = await verifyPassword(body.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) return reply.code(401).send({ error: 'Correo o contraseña incorrectos' });
    await createSession(reply, u.id);
    return { user: { id: u.id, email: u.email, name: u.name } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Sin sesión' });
    return { user: req.user };
  });

  // ---------- Compartir (sólo el dueño) ----------
  const owner = { config: { ownerOnly: true } };

  async function sharing(treeId: string) {
    const [members, invites, tree] = await Promise.all([
      pool.query(
        `SELECT u.id AS "userId", u.name, u.email, m.role FROM tree_members m JOIN users u ON u.id = m.user_id
          WHERE m.tree_id = $1 ORDER BY (m.role = 'owner') DESC, u.name`,
        [treeId],
      ),
      pool.query('SELECT email, role FROM tree_invites WHERE tree_id = $1 ORDER BY created_at', [treeId]),
      pool.query('SELECT public_token AS "publicToken" FROM trees WHERE id = $1', [treeId]),
    ]);
    return { members: members.rows, invites: invites.rows, publicToken: tree.rows[0]?.publicToken ?? null };
  }

  app.get('/api/trees/:treeId/sharing', owner, async (req) => sharing((req.params as { treeId: string }).treeId));

  /** Dar acceso de edición por correo. Si aún no tiene cuenta, queda como invitación pendiente. */
  app.post('/api/trees/:treeId/members', owner, async (req, reply) => {
    const { treeId } = req.params as { treeId: string };
    const body = z.object({ email }).parse(req.body);
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [body.email]);
    if (rows[0]) {
      const res = await pool.query(
        `INSERT INTO tree_members(tree_id, user_id, role) VALUES ($1, $2, 'editor') ON CONFLICT DO NOTHING`,
        [treeId, rows[0].id],
      );
      if (!res.rowCount) return reply.code(409).send({ error: 'Esa persona ya tiene acceso' });
    } else {
      await pool.query(
        `INSERT INTO tree_invites(tree_id, email, invited_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [treeId, body.email, req.user!.id],
      );
    }
    return sharing(treeId);
  });

  /** Quitar acceso. El dueño puede quitar a cualquier editor; un editor puede salirse él mismo. */
  app.delete('/api/trees/:treeId/members/:userId', async (req, reply) => {
    const { treeId, userId } = z.object({ treeId: uuid, userId: uuid }).parse(req.params);
    const self = userId === req.user!.id;
    if (req.treeRole !== 'owner' && !self) return reply.code(403).send({ error: 'Sólo el dueño puede quitar accesos' });
    if (self && req.treeRole === 'owner') return reply.code(400).send({ error: 'El dueño no puede salir de su propio árbol' });
    await pool.query(`DELETE FROM tree_members WHERE tree_id = $1 AND user_id = $2 AND role <> 'owner'`, [treeId, userId]);
    return self ? { ok: true } : sharing(treeId);
  });

  app.delete('/api/trees/:treeId/invites', owner, async (req) => {
    const { treeId } = req.params as { treeId: string };
    const q = z.object({ email }).parse(req.query);
    await pool.query('DELETE FROM tree_invites WHERE tree_id = $1 AND email = $2', [treeId, q.email]);
    return sharing(treeId);
  });

  /** Activar / desactivar / regenerar el enlace público de sólo lectura. */
  app.post('/api/trees/:treeId/public-link', owner, async (req) => {
    const { treeId } = req.params as { treeId: string };
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await pool.query('UPDATE trees SET public_token = $2 WHERE id = $1', [treeId, enabled ? newPublicToken() : null]);
    return sharing(treeId);
  });
}

export { treeRole };
