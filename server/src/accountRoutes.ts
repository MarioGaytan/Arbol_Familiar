import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from './db.js';
import {
  claimInvites, createSession, destroySession, DUMMY_HASH, hashPassword, newPublicToken, sha256, treeRole,
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
    if (req.url.startsWith('/api/admin/') && !req.user.isAdmin) return reply.code(403).send({ error: 'Sólo para administradores' });

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

  /** ¿Todavía no hay ninguna cuenta? Entonces la primera persona crea la cuenta de administrador. */
  app.get('/api/auth/setup', async () => {
    const { rows } = await pool.query('SELECT NOT EXISTS (SELECT 1 FROM users) AS "needsSetup"');
    return rows[0];
  });

  const inviteLimit = { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } };

  /** Comprueba un enlace de invitación antes de mostrar el formulario de registro. */
  app.get('/api/auth/invite/:token', inviteLimit, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(16).max(80) }).parse(req.params);
    const { rows } = await pool.query(
      `SELECT email, expires_at AS "expiresAt", used_at AS "usedAt", revoked_at AS "revokedAt"
         FROM registration_invites WHERE token_hash = $1`,
      [sha256(token)],
    );
    const inv = rows[0];
    if (!inv) return reply.code(404).send({ error: 'Este enlace de invitación no existe.' });
    if (inv.usedAt) return reply.code(410).send({ error: 'Este enlace de invitación ya se usó.' });
    if (inv.revokedAt) return reply.code(410).send({ error: 'Este enlace de invitación fue cancelado.' });
    if (new Date(inv.expiresAt) < new Date()) return reply.code(410).send({ error: 'Este enlace de invitación caducó.' });
    return { email: inv.email, expiresAt: inv.expiresAt };
  });

  app.post('/api/auth/register', authLimit, async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1, 'Escribe tu nombre').max(120),
        email,
        password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
        invite: z.string().min(16).max(80).optional(),
      })
      .parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const user = await tx(async (c) => {
      // Serializa los registros: evita que dos personas "sean la primera" o usen la misma invitación a la vez
      await c.query('SELECT pg_advisory_xact_lock(4242)');
      const { rows: cnt } = await c.query('SELECT count(*)::int AS n FROM users');
      const first = cnt[0].n === 0;

      let inviteId: string | null = null;
      if (!first) {
        if (!body.invite) throw Object.assign(new Error('El registro es sólo por invitación. Pide un enlace al administrador.'), { statusCode: 403 });
        // Consumir la invitación de forma atómica: sólo una petición puede marcarla como usada
        const { rows } = await c.query(
          `UPDATE registration_invites SET used_at = now()
            WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
            RETURNING id, email`,
          [sha256(body.invite)],
        );
        if (!rows[0]) throw Object.assign(new Error('El enlace de invitación no es válido, ya se usó o caducó.'), { statusCode: 403 });
        if (rows[0].email && rows[0].email.toLowerCase() !== body.email) {
          throw Object.assign(new Error(`Esta invitación es para ${rows[0].email}.`), { statusCode: 403 });
        }
        inviteId = rows[0].id;
      }

      const exists = await c.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
      if (exists.rowCount) throw Object.assign(new Error('Ya existe una cuenta con ese correo'), { statusCode: 409 });
      const { rows } = await c.query(
        `INSERT INTO users(name, email, password_hash, is_admin, last_login_at) VALUES ($1, $2, $3, $4, now())
         RETURNING id, email, name, is_admin AS "isAdmin"`,
        [body.name, body.email, passwordHash, first],
      );
      const u = rows[0];
      if (inviteId) await c.query('UPDATE registration_invites SET used_by = $1 WHERE id = $2', [u.id, inviteId]);
      await claimInvites(c, u.id, body.email);
      if (first) {
        // Primer usuario de la instalación: administrador y dueño de los árboles creados antes de existir cuentas
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
    const { rows } = await pool.query(
      'SELECT id, email, name, password_hash, is_admin AS "isAdmin", status FROM users WHERE email = $1',
      [body.email],
    );
    const u = rows[0];
    const ok = await verifyPassword(body.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) return reply.code(401).send({ error: 'Correo o contraseña incorrectos' });
    // Sólo después de comprobar la contraseña se revela que la cuenta está bloqueada
    if (u.status !== 'active') return reply.code(403).send({ error: 'Tu cuenta está desactivada. Contacta al administrador.' });
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
    await createSession(reply, u.id);
    return { user: { id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin } };
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
