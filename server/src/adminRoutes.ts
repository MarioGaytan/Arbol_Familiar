import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from './db.js';
import { newInviteToken, sha256 } from './auth.js';

const uuid = z.string().uuid();

/**
 * Panel de administración (el permiso de admin lo exige el hook global para todo /api/admin/*)
 * y diseños guardados por cada usuario (/api/me/themes).
 */
export async function registerAdminRoutes(app: FastifyInstance) {
  // ---------- Resumen ----------
  app.get('/api/admin/stats', async () => {
    const { rows } = await pool.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM users WHERE status = 'blocked') AS blocked,
      (SELECT count(*)::int FROM trees) AS trees,
      (SELECT count(*)::int FROM persons) AS persons,
      (SELECT count(*)::int FROM uploads) AS photos,
      (SELECT coalesce(sum(bytes), 0)::bigint FROM uploads) AS "photoBytes",
      (SELECT count(*)::int FROM registration_invites
         WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS "pendingInvites"`);
    return { ...rows[0], photoBytes: Number(rows[0].photoBytes) };
  });

  // ---------- Usuarios ----------
  app.get('/api/admin/users', async () => {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.is_admin AS "isAdmin", u.status,
             u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
             (SELECT count(*)::int FROM tree_members m WHERE m.user_id = u.id AND m.role = 'owner') AS "ownedTrees",
             (SELECT count(*)::int FROM tree_members m WHERE m.user_id = u.id AND m.role = 'editor') AS "sharedTrees",
             inv.name AS "invitedBy"
        FROM users u
        LEFT JOIN registration_invites ri ON ri.used_by = u.id
        LEFT JOIN users inv ON inv.id = ri.created_by
       ORDER BY u.created_at`);
    return rows;
  });

  /** Permitir / negar acceso y dar / quitar rol de administrador. */
  app.patch('/api/admin/users/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ status: z.enum(['active', 'blocked']).optional(), isAdmin: z.boolean().optional() }).parse(req.body);
    if (id === req.user!.id) return reply.code(400).send({ error: 'No puedes cambiar tu propio acceso ni tu rol (evita quedarte fuera).' });
    return tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(4243)');
      const { rows } = await c.query(
        `UPDATE users SET status = coalesce($2, status), is_admin = coalesce($3, is_admin) WHERE id = $1
         RETURNING id, name, email, is_admin AS "isAdmin", status`,
        [id, body.status ?? null, body.isAdmin ?? null],
      );
      if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { statusCode: 404 });
      const admins = await c.query(`SELECT count(*)::int AS n FROM users WHERE is_admin AND status = 'active'`);
      if (admins.rows[0].n < 1) throw Object.assign(new Error('Debe quedar al menos un administrador activo.'), { statusCode: 400 });
      // Bloquear = cerrar todas sus sesiones al instante
      if (body.status === 'blocked') await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      return rows[0];
    });
  });

  // ---------- Invitaciones de registro ----------
  const INVITE_COLS = `ri.id, ri.email, ri.note, ri.created_at AS "createdAt", ri.expires_at AS "expiresAt",
    ri.used_at AS "usedAt", ri.revoked_at AS "revokedAt", cu.name AS "createdBy", uu.name AS "usedBy",
    CASE WHEN ri.used_at IS NOT NULL THEN 'used'
         WHEN ri.revoked_at IS NOT NULL THEN 'revoked'
         WHEN ri.expires_at <= now() THEN 'expired'
         ELSE 'pending' END AS status`;
  const INVITE_FROM = `FROM registration_invites ri
    LEFT JOIN users cu ON cu.id = ri.created_by LEFT JOIN users uu ON uu.id = ri.used_by`;

  app.get('/api/admin/invites', async () => {
    const { rows } = await pool.query(`SELECT ${INVITE_COLS} ${INVITE_FROM} ORDER BY ri.created_at DESC LIMIT 200`);
    return rows;
  });

  /** Crea un enlace de un solo uso. El token sólo se devuelve ahora: en la base queda su hash. */
  app.post('/api/admin/invites', async (req) => {
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email('Correo inválido').max(200).optional().or(z.literal('').transform(() => undefined)),
        note: z.string().trim().max(200).optional(),
        hours: z.number().int().min(1).max(24 * 30),
      })
      .parse(req.body);
    const token = newInviteToken();
    const { rows } = await pool.query(
      `INSERT INTO registration_invites(token_hash, email, note, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5)) RETURNING id`,
      [sha256(token), body.email ?? null, body.note || null, req.user!.id, body.hours],
    );
    const inv = await pool.query(`SELECT ${INVITE_COLS} ${INVITE_FROM} WHERE ri.id = $1`, [rows[0].id]);
    return { invite: inv.rows[0], token };
  });

  app.delete('/api/admin/invites/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { rowCount } = await pool.query(
      'UPDATE registration_invites SET revoked_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL',
      [id],
    );
    if (!rowCount) return reply.code(400).send({ error: 'Esa invitación ya se usó o ya estaba cancelada' });
    return { ok: true };
  });

  // ---------- Diseños propios de cada usuario ----------
  const themeBody = z.object({
    name: z.string().trim().min(1, 'Ponle un nombre al diseño').max(60),
    theme: z.record(z.union([z.string().max(120), z.number(), z.boolean(), z.null()])).refine((t) => Object.keys(t).length <= 40),
  });
  const THEME_COLS = 'id, name, theme, updated_at AS "updatedAt"';

  app.get('/api/me/themes', async (req) => {
    const { rows } = await pool.query(`SELECT ${THEME_COLS} FROM user_themes WHERE user_id = $1 ORDER BY created_at`, [req.user!.id]);
    return rows;
  });

  app.post('/api/me/themes', async (req, reply) => {
    const body = themeBody.parse(req.body);
    const { rows: cnt } = await pool.query('SELECT count(*)::int AS n FROM user_themes WHERE user_id = $1', [req.user!.id]);
    if (cnt[0].n >= 30) return reply.code(400).send({ error: 'Máximo 30 diseños guardados' });
    const { rows } = await pool.query(
      `INSERT INTO user_themes(user_id, name, theme) VALUES ($1, $2, $3) RETURNING ${THEME_COLS}`,
      [req.user!.id, body.name, JSON.stringify(body.theme)],
    );
    return rows[0];
  });

  app.patch('/api/me/themes/:id', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = themeBody.partial().parse(req.body);
    const { rows } = await pool.query(
      `UPDATE user_themes SET name = coalesce($3, name), theme = coalesce($4, theme)
        WHERE id = $1 AND user_id = $2 RETURNING ${THEME_COLS}`,
      [id, req.user!.id, body.name ?? null, body.theme ? JSON.stringify(body.theme) : null],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Diseño no encontrado' });
    return rows[0];
  });

  app.delete('/api/me/themes/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await pool.query('DELETE FROM user_themes WHERE id = $1 AND user_id = $2', [id, req.user!.id]);
    return { ok: true };
  });
}
