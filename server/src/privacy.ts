import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from './db.js';
import { destroySession, hashPassword, verifyPassword } from './auth.js';

/**
 * Protección de datos personales (LFPDPPP, México).
 *
 * LEGAL_VERSION identifica la versión vigente del Aviso de Privacidad y los Términos. Si cambia,
 * a cada usuario se le vuelve a pedir su aceptación antes de seguir usando la app.
 */
export const LEGAL_VERSION = '2026-10-07';

/** Datos del responsable del tratamiento: se configuran con variables de entorno. */
export function legalConfig() {
  const env = process.env;
  const controller = {
    name: env.LEGAL_CONTROLLER_NAME?.trim() || null,
    address: env.LEGAL_CONTROLLER_ADDRESS?.trim() || null,
    email: env.LEGAL_CONTACT_EMAIL?.trim() || null,
  };
  return {
    version: LEGAL_VERSION,
    controller,
    siteUrl: env.PUBLIC_SITE_URL?.trim() || null,
    configured: Boolean(controller.name && controller.address && controller.email),
  };
}

export const needsConsent = (version: string | null | undefined) => version !== LEGAL_VERSION;

/** Rutas que se pueden usar aunque falte aceptar la versión vigente del aviso. */
export const CONSENT_EXEMPT = ['/api/me/consent', '/api/me/export', '/api/me/delete', '/api/legal'];

export async function registerPrivacyRoutes(app: FastifyInstance) {
  // Información pública para las páginas legales
  app.get('/api/legal', async () => legalConfig());

  /** Aceptar la versión vigente del Aviso de Privacidad y Términos (re-consentimiento). */
  app.post('/api/me/consent', async (req) => {
    z.object({ accept: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar el aviso para continuar' }) }) }).parse(req.body);
    await tx(async (c) => {
      await c.query('UPDATE users SET legal_version = $2, legal_accepted_at = now() WHERE id = $1', [req.user!.id, LEGAL_VERSION]);
      await c.query('INSERT INTO consent_log(user_id, version) VALUES ($1, $2)', [req.user!.id, LEGAL_VERSION]);
    });
    return { ok: true, version: LEGAL_VERSION };
  });

  // ---------- Derechos ARCO ----------

  /** Rectificación: corregir el nombre de la cuenta. */
  app.patch('/api/me', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1, 'Escribe tu nombre').max(120) }).parse(req.body);
    const { rows } = await pool.query('UPDATE users SET name = $2 WHERE id = $1 RETURNING id, email, name, is_admin AS "isAdmin"', [req.user!.id, name]);
    return { user: rows[0] };
  });

  app.post('/api/me/password', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const body = z
      .object({ current: z.string().max(200), next: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres').max(200) })
      .parse(req.body);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
    if (!(await verifyPassword(body.current, rows[0].password_hash))) return reply.code(400).send({ error: 'La contraseña actual no es correcta' });
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user!.id, await hashPassword(body.next)]);
    // Cerrar las demás sesiones abiertas con la contraseña anterior
    await pool.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> sha256(convert_to($2, 'UTF8'))", [req.user!.id, req.cookies.sid ?? '']);
    return { ok: true };
  });

  /**
   * Acceso / portabilidad: todos los datos de la cuenta y de los árboles de los que es dueño, en JSON.
   * (Los árboles compartidos por otros pertenecen a su dueño; se listan sólo como membresías.)
   */
  app.get('/api/me/export', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const uid = req.user!.id;
    const [account, consents, memberships, themes] = await Promise.all([
      pool.query(
        `SELECT id, name, email, is_admin AS "isAdmin", status, created_at AS "createdAt", last_login_at AS "lastLoginAt",
                legal_version AS "legalVersion", legal_accepted_at AS "legalAcceptedAt" FROM users WHERE id = $1`,
        [uid],
      ),
      pool.query('SELECT version, accepted_at AS "acceptedAt" FROM consent_log WHERE user_id = $1 ORDER BY accepted_at', [uid]),
      pool.query(
        `SELECT t.id, t.name, m.role, m.created_at AS "since" FROM tree_members m JOIN trees t ON t.id = m.tree_id WHERE m.user_id = $1`,
        [uid],
      ),
      pool.query('SELECT name, theme, created_at AS "createdAt" FROM user_themes WHERE user_id = $1', [uid]),
    ]);
    const owned = memberships.rows.filter((m) => m.role === 'owner');
    const trees = [];
    for (const t of owned) {
      const [persons, pc, partners] = await Promise.all([
        pool.query(
          `SELECT id, first_name AS "firstName", last_name AS "lastName", gender, birth_date AS "birthDate", birth_precision AS "birthPrecision",
                  death_date AS "deathDate", death_precision AS "deathPrecision", birth_place AS "birthPlace", notes, photo_url AS "photoUrl"
             FROM persons WHERE tree_id = $1 ORDER BY created_at`,
          [t.id],
        ),
        pool.query('SELECT parent_id AS "parentId", child_id AS "childId", kind FROM parent_child WHERE tree_id = $1', [t.id]),
        pool.query('SELECT person_a AS "personA", person_b AS "personB", kind FROM partnerships WHERE tree_id = $1', [t.id]),
      ]);
      trees.push({ id: t.id, name: t.name, persons: persons.rows, parentChild: pc.rows, partnerships: partners.rows });
    }
    const data = {
      generatedAt: new Date().toISOString(),
      note: 'Exportación de tus datos personales (derecho de acceso y portabilidad, LFPDPPP).',
      account: account.rows[0],
      consents: consents.rows,
      memberships: memberships.rows,
      ownedTrees: trees,
      savedThemes: themes.rows,
    };
    reply.header('Content-Disposition', 'attachment; filename="mis-datos-raices.json"');
    return data;
  });

  /**
   * Cancelación: elimina la cuenta, los árboles de los que es dueño (con sus personas y vínculos) y todas
   * sus sesiones. Las fotos que quedan sin uso se borran en la limpieza periódica.
   */
  app.post('/api/me/delete', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    const uid = req.user!.id;
    const { rows } = await pool.query('SELECT password_hash, is_admin FROM users WHERE id = $1', [uid]);
    if (!(await verifyPassword(password, rows[0].password_hash))) return reply.code(400).send({ error: 'La contraseña no es correcta' });
    const result = await tx(async (c) => {
      if (rows[0].is_admin) {
        const others = await c.query(`SELECT count(*)::int AS n FROM users WHERE id <> $1`, [uid]);
        const admins = await c.query(`SELECT count(*)::int AS n FROM users WHERE is_admin AND status = 'active' AND id <> $1`, [uid]);
        if (others.rows[0].n > 0 && admins.rows[0].n === 0) {
          throw Object.assign(new Error('Eres el único administrador: nombra a otro administrador antes de eliminar tu cuenta.'), { statusCode: 400 });
        }
      }
      const del = await c.query(
        `DELETE FROM trees WHERE id IN (SELECT tree_id FROM tree_members WHERE user_id = $1 AND role = 'owner') RETURNING id`,
        [uid],
      );
      await c.query('DELETE FROM users WHERE id = $1', [uid]);
      return { deletedTrees: del.rowCount };
    });
    await destroySession(req, reply);
    req.log.info({ deletedTrees: result.deletedTrees }, 'cuenta eliminada a solicitud del titular');
    return { ok: true, ...result };
  });
}
