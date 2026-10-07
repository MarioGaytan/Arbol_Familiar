import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { pool, tx } from './db.js';
import { saveFile } from './storage.js';

// ---------- SQL helpers ----------

const dateOut = (col: string, prec: string, alias: string) =>
  `CASE ${prec} WHEN 'year' THEN to_char(${col}, 'YYYY') WHEN 'month' THEN to_char(${col}, 'YYYY-MM')
   ELSE to_char(${col}, 'YYYY-MM-DD') END AS "${alias}"`;

const PERSON_COLS = `id, tree_id AS "treeId", first_name AS "firstName", last_name AS "lastName", gender,
  ${dateOut('birth_date', 'birth_precision', 'birthDate')},
  ${dateOut('death_date', 'death_precision', 'deathDate')},
  birth_place AS "birthPlace", notes, photo_url AS "photoUrl", color, pos_x AS "posX", pos_y AS "posY"`;

const PC_COLS = `parent_id AS "parentId", child_id AS "childId", kind`;
const PARTNER_COLS = `id, person_a AS "personA", person_b AS "personB", kind`;
const TREE_COLS = `id, name, root_person_id AS "rootPersonId", theme, updated_at AS "updatedAt"`;

/** "1950" | "1950-03" | "1950-03-12" → [fecha para DB, precisión] */
function toDbDate(d: string | null | undefined): [string | null, string | null] {
  if (!d) return [null, null];
  const parts = d.split('-');
  if (parts.length === 1) return [`${d}-01-01`, 'year'];
  if (parts.length === 2) return [`${d}-01`, 'month'];
  return [d, 'day'];
}

// ---------- Validación ----------

const uuid = z.string().uuid();
const partialDate = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, 'Usa AAAA, AAAA-MM o AAAA-MM-DD')
  .nullable()
  .optional();
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

const personInput = z.object({
  firstName: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  lastName: optText(120),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  birthDate: partialDate,
  deathDate: partialDate,
  birthPlace: optText(200),
  notes: optText(5000),
  photoUrl: optText(1000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  posX: z.number().finite().nullable().optional(),
  posY: z.number().finite().nullable().optional(),
});

const parentKind = z.enum(['biological', 'adoptive', 'step', 'foster']);
const partnerKind = z.enum(['married', 'partner', 'divorced', 'separated', 'widowed']);

const createPersonBody = z.object({
  person: personInput,
  parents: z.array(z.object({ id: uuid, kind: parentKind.optional() })).max(4).default([]),
  children: z.array(uuid).max(50).default([]),
  partners: z.array(uuid).max(10).default([]),
});

const PERSON_FIELD_MAP: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  gender: 'gender',
  birthPlace: 'birth_place',
  notes: 'notes',
  photoUrl: 'photo_url',
  color: 'color',
  posX: 'pos_x',
  posY: 'pos_y',
};

/** Convierte un objeto persona (parcial) a pares columna/valor para SQL. */
function personColumns(p: Partial<z.infer<typeof personInput>>) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [key, col] of Object.entries(PERSON_FIELD_MAP)) {
    if (key in p) {
      cols.push(col);
      const v = (p as Record<string, unknown>)[key];
      vals.push(typeof v === 'string' && v.trim() === '' && key !== 'firstName' ? null : v);
    }
  }
  for (const [key, col, precCol] of [
    ['birthDate', 'birth_date', 'birth_precision'],
    ['deathDate', 'death_date', 'death_precision'],
  ] as const) {
    if (key in p) {
      const [date, prec] = toDbDate(p[key]);
      cols.push(col, precCol);
      vals.push(date, prec);
    }
  }
  return { cols, vals };
}

async function assertTree(c: pg.PoolClient | pg.Pool, treeId: string) {
  const { rowCount } = await c.query('SELECT 1 FROM trees WHERE id = $1', [treeId]);
  if (!rowCount) throw Object.assign(new Error('Árbol no encontrado'), { statusCode: 404 });
}

async function insertPartnership(c: pg.PoolClient, treeId: string, x: string, y: string, kind = 'married') {
  const [a, b] = x < y ? [x, y] : [y, x];
  const { rows } = await c.query(
    `INSERT INTO partnerships(tree_id, person_a, person_b, kind) VALUES ($1,$2,$3,$4) RETURNING ${PARTNER_COLS}`,
    [treeId, a, b, kind],
  );
  return rows[0];
}

const notFound = (what: string) => Object.assign(new Error(`${what} no encontrado`), { statusCode: 404 });

// ---------- Rutas ----------

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  // ----- Árboles -----
  /** Sólo los árboles donde el usuario es dueño o editor. */
  app.get('/api/trees', async (req) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.root_person_id AS "rootPersonId", t.theme, t.updated_at AS "updatedAt", m.role,
              (SELECT count(*)::int FROM persons p WHERE p.tree_id = t.id) AS "personCount",
              (SELECT photo_url FROM persons p WHERE p.id = t.root_person_id) AS "rootPhoto",
              (SELECT u.name FROM tree_members o JOIN users u ON u.id = o.user_id
                WHERE o.tree_id = t.id AND o.role = 'owner') AS "ownerName"
         FROM trees t JOIN tree_members m ON m.tree_id = t.id AND m.user_id = $1
        ORDER BY t.updated_at DESC`,
      [req.user!.id],
    );
    return rows;
  });

  app.post('/api/trees', async (req) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(120), rootPerson: personInput.optional() })
      .parse(req.body);
    return tx(async (c) => {
      const { rows } = await c.query(`INSERT INTO trees(name) VALUES ($1) RETURNING ${TREE_COLS}`, [body.name]);
      const tree = rows[0];
      await c.query(`INSERT INTO tree_members(tree_id, user_id, role) VALUES ($1, $2, 'owner')`, [tree.id, req.user!.id]);
      if (body.rootPerson) {
        const { cols, vals } = personColumns({ posX: 0, posY: 0, ...body.rootPerson });
        const ph = vals.map((_, i) => `$${i + 2}`).join(',');
        const p = await c.query(`INSERT INTO persons(tree_id, ${cols.join(',')}) VALUES ($1, ${ph}) RETURNING id`, [
          tree.id,
          ...vals,
        ]);
        await c.query('UPDATE trees SET root_person_id = $1 WHERE id = $2', [p.rows[0].id, tree.id]);
        tree.rootPersonId = p.rows[0].id;
      }
      return tree;
    });
  });

  app.get('/api/trees/:treeId', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const data = await loadTree(treeId);
    if (!data) throw notFound('Árbol');
    return { ...data, tree: { ...data.tree, role: req.treeRole } };
  });

  /** Vista pública de sólo lectura: sin sesión, por token. Las notas privadas no se incluyen. */
  app.get('/api/public/:token', async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(64) }).parse(req.params);
    const { rows } = await pool.query('SELECT id FROM trees WHERE public_token = $1', [token]);
    if (!rows[0]) throw notFound('Enlace');
    const data = (await loadTree(rows[0].id))!;
    return {
      tree: { ...data.tree, role: 'viewer' },
      persons: data.persons.map((p: Record<string, unknown>) => ({ ...p, notes: null })),
      parentChild: data.parentChild,
      partnerships: data.partnerships,
    };
  });

  async function loadTree(treeId: string) {
    const tree = await pool.query(`SELECT ${TREE_COLS} FROM trees WHERE id = $1`, [treeId]);
    if (!tree.rowCount) return null;
    const [persons, parentChild, partnerships] = await Promise.all([
      pool.query(`SELECT ${PERSON_COLS} FROM persons WHERE tree_id = $1 ORDER BY created_at`, [treeId]),
      pool.query(`SELECT ${PC_COLS} FROM parent_child WHERE tree_id = $1`, [treeId]),
      pool.query(`SELECT ${PARTNER_COLS} FROM partnerships WHERE tree_id = $1`, [treeId]),
    ]);
    return {
      tree: tree.rows[0],
      persons: persons.rows,
      parentChild: parentChild.rows,
      partnerships: partnerships.rows,
    };
  }

  app.patch('/api/trees/:treeId', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        rootPersonId: uuid.nullable().optional(),
        theme: z.record(z.unknown()).optional(),
      })
      .parse(req.body);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (body.name !== undefined) vals.push(body.name), sets.push(`name = $${vals.length}`);
    if (body.rootPersonId !== undefined) vals.push(body.rootPersonId), sets.push(`root_person_id = $${vals.length}`);
    if (body.theme !== undefined) vals.push(JSON.stringify(body.theme)), sets.push(`theme = $${vals.length}`);
    if (!sets.length) return { ok: true };
    vals.push(treeId);
    const { rows } = await pool.query(
      `UPDATE trees SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING ${TREE_COLS}`,
      vals,
    );
    if (!rows.length) throw notFound('Árbol');
    return rows[0];
  });

  app.delete('/api/trees/:treeId', { config: { ownerOnly: true } }, async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    await pool.query('DELETE FROM trees WHERE id = $1', [treeId]);
    return { ok: true };
  });

  // ----- Deshacer / borrar en bloque -----

  /** Reinserta personas y vínculos con sus mismos ids (deshacer un borrado, rehacer una creación). */
  /** Personas + vínculos con sus ids (deshacer/rehacer e importación GEDCOM). */
  const snapshotSchema = (maxPersons: number) =>
    z.object({
      persons: z.array(personInput.extend({ id: uuid })).max(maxPersons).default([]),
      parentChild: z.array(pcBody.required({ kind: true })).max(maxPersons * 3).default([]),
      partnerships: z
        .array(z.object({ id: uuid, personA: uuid, personB: uuid, kind: partnerKind }))
        .max(maxPersons)
        .default([]),
    });

  async function insertSnapshot(c: pg.PoolClient, treeId: string, body: z.infer<ReturnType<typeof snapshotSchema>>) {
    const persons = [];
    for (const p of body.persons) {
      const { cols, vals } = personColumns(p);
      const ph = vals.map((_, i) => `$${i + 3}`).join(',');
      const { rows } = await c.query(
        `INSERT INTO persons(id, tree_id, ${cols.join(',')}) VALUES ($1, $2, ${ph}) RETURNING ${PERSON_COLS}`,
        [p.id, treeId, ...vals],
      );
      persons.push(rows[0]);
    }
    const parentChild = [];
    for (const r of body.parentChild) {
      const { rows } = await c.query(
        `INSERT INTO parent_child(tree_id, parent_id, child_id, kind) VALUES ($1,$2,$3,$4) RETURNING ${PC_COLS}`,
        [treeId, r.parentId, r.childId, r.kind],
      );
      parentChild.push(rows[0]);
    }
    const partnerships = [];
    for (const p of body.partnerships) {
      const [a, b] = p.personA < p.personB ? [p.personA, p.personB] : [p.personB, p.personA];
      const { rows } = await c.query(
        `INSERT INTO partnerships(id, tree_id, person_a, person_b, kind) VALUES ($1,$2,$3,$4,$5) RETURNING ${PARTNER_COLS}`,
        [p.id, treeId, a, b, p.kind],
      );
      partnerships.push(rows[0]);
    }
    return { persons, parentChild, partnerships };
  }

  /** Reinserta personas y vínculos con sus mismos ids (deshacer un borrado, rehacer una creación). */
  app.post('/api/trees/:treeId/restore', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const body = snapshotSchema(2000).parse(req.body);
    return tx(async (c) => {
      await assertTree(c, treeId);
      return insertSnapshot(c, treeId, body);
    });
  });

  /**
   * Crea un árbol completo de una vez (importación GEDCOM). Todo en una transacción:
   * si alguna relación viola las reglas (p. ej. un ciclo), no se crea nada.
   */
  app.post('/api/trees/import', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const body = snapshotSchema(10000)
      .extend({ name: z.string().trim().min(1).max(120), rootPersonId: uuid.nullable().optional() })
      .parse(req.body);
    return tx(async (c) => {
      const { rows } = await c.query(`INSERT INTO trees(name) VALUES ($1) RETURNING ${TREE_COLS}`, [body.name]);
      const tree = rows[0];
      await c.query(`INSERT INTO tree_members(tree_id, user_id, role) VALUES ($1, $2, 'owner')`, [tree.id, req.user!.id]);
      await insertSnapshot(c, tree.id, body);
      const root = body.rootPersonId && body.persons.some((p) => p.id === body.rootPersonId) ? body.rootPersonId : body.persons[0]?.id;
      if (root) await c.query('UPDATE trees SET root_person_id = $1 WHERE id = $2', [root, tree.id]);
      return { id: tree.id, persons: body.persons.length };
    });
  });

  app.post('/api/trees/:treeId/persons/delete', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const { ids } = z.object({ ids: z.array(uuid).min(1).max(2000) }).parse(req.body);
    await pool.query('DELETE FROM persons WHERE tree_id = $1 AND id = ANY($2::uuid[])', [treeId, ids]);
    return { ok: true };
  });

  // ----- Personas -----

  /** Crea una persona y sus vínculos en una sola transacción: si una regla falla, no se crea nada. */
  app.post('/api/trees/:treeId/persons', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const body = createPersonBody.parse(req.body);
    return tx(async (c) => {
      await assertTree(c, treeId);
      const { cols, vals } = personColumns(body.person);
      const ph = vals.map((_, i) => `$${i + 2}`).join(',');
      const { rows } = await c.query(
        `INSERT INTO persons(tree_id, ${cols.join(',')}) VALUES ($1, ${ph}) RETURNING ${PERSON_COLS}`,
        [treeId, ...vals],
      );
      const person = rows[0];
      const parentChild = [];
      const partnerships = [];
      for (const par of body.parents) {
        const r = await c.query(
          `INSERT INTO parent_child(tree_id, parent_id, child_id, kind) VALUES ($1,$2,$3,$4) RETURNING ${PC_COLS}`,
          [treeId, par.id, person.id, par.kind ?? 'biological'],
        );
        parentChild.push(r.rows[0]);
      }
      for (const childId of body.children) {
        const r = await c.query(
          `INSERT INTO parent_child(tree_id, parent_id, child_id) VALUES ($1,$2,$3) RETURNING ${PC_COLS}`,
          [treeId, person.id, childId],
        );
        parentChild.push(r.rows[0]);
      }
      for (const partnerId of body.partners) {
        partnerships.push(await insertPartnership(c, treeId, person.id, partnerId));
      }
      return { person, parentChild, partnerships };
    });
  });

  app.patch('/api/trees/:treeId/persons/:id', async (req) => {
    const { treeId, id } = z.object({ treeId: uuid, id: uuid }).parse(req.params);
    const patch = personInput.partial().parse(req.body);
    const { cols, vals } = personColumns(patch);
    if (!cols.length) throw Object.assign(new Error('Nada que actualizar'), { statusCode: 400 });
    const sets = cols.map((col, i) => `${col} = $${i + 3}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE persons SET ${sets} WHERE id = $1 AND tree_id = $2 RETURNING ${PERSON_COLS}`,
      [id, treeId, ...vals],
    );
    if (!rows.length) throw notFound('Persona');
    return rows[0];
  });

  app.delete('/api/trees/:treeId/persons/:id', async (req) => {
    const { treeId, id } = z.object({ treeId: uuid, id: uuid }).parse(req.params);
    await pool.query('DELETE FROM persons WHERE id = $1 AND tree_id = $2', [id, treeId]);
    return { ok: true };
  });

  /** Guarda en bloque las posiciones tras arrastrar u ordenar automáticamente. */
  app.put('/api/trees/:treeId/positions', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const items = z
      .array(z.object({ id: uuid, x: z.number().finite(), y: z.number().finite() }))
      .max(5000)
      .parse(req.body);
    if (!items.length) return { ok: true };
    await pool.query(
      `UPDATE persons p SET pos_x = v.x, pos_y = v.y
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::float8[]) AS x, unnest($3::float8[]) AS y) v
        WHERE p.id = v.id AND p.tree_id = $4`,
      [items.map((i) => i.id), items.map((i) => i.x), items.map((i) => i.y), treeId],
    );
    return { ok: true };
  });

  // ----- Relaciones padre/hijo -----
  const pcBody = z.object({ parentId: uuid, childId: uuid, kind: parentKind.optional() });

  app.post('/api/trees/:treeId/parent-child', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const b = pcBody.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO parent_child(tree_id, parent_id, child_id, kind) VALUES ($1,$2,$3,$4) RETURNING ${PC_COLS}`,
      [treeId, b.parentId, b.childId, b.kind ?? 'biological'],
    );
    return rows[0];
  });

  app.patch('/api/trees/:treeId/parent-child', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const b = pcBody.required({ kind: true }).parse(req.body);
    const { rows } = await pool.query(
      `UPDATE parent_child SET kind = $4 WHERE tree_id = $1 AND parent_id = $2 AND child_id = $3 RETURNING ${PC_COLS}`,
      [treeId, b.parentId, b.childId, b.kind],
    );
    if (!rows.length) throw notFound('Relación');
    return rows[0];
  });

  app.delete('/api/trees/:treeId/parent-child', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const q = z.object({ parentId: uuid, childId: uuid }).parse(req.query);
    await pool.query('DELETE FROM parent_child WHERE tree_id = $1 AND parent_id = $2 AND child_id = $3', [
      treeId,
      q.parentId,
      q.childId,
    ]);
    return { ok: true };
  });

  // ----- Parejas -----
  app.post('/api/trees/:treeId/partnerships', async (req) => {
    const { treeId } = z.object({ treeId: uuid }).parse(req.params);
    const b = z.object({ personA: uuid, personB: uuid, kind: partnerKind.optional() }).parse(req.body);
    if (b.personA === b.personB) throw Object.assign(new Error('Una persona no puede ser su propia pareja'), { statusCode: 400 });
    return tx((c) => insertPartnership(c, treeId, b.personA, b.personB, b.kind));
  });

  app.patch('/api/trees/:treeId/partnerships/:id', async (req) => {
    const { treeId, id } = z.object({ treeId: uuid, id: uuid }).parse(req.params);
    const b = z.object({ kind: partnerKind }).parse(req.body);
    const { rows } = await pool.query(
      `UPDATE partnerships SET kind = $3 WHERE id = $1 AND tree_id = $2 RETURNING ${PARTNER_COLS}`,
      [id, treeId, b.kind],
    );
    if (!rows.length) throw notFound('Pareja');
    return rows[0];
  });

  app.delete('/api/trees/:treeId/partnerships/:id', async (req) => {
    const { treeId, id } = z.object({ treeId: uuid, id: uuid }).parse(req.params);
    await pool.query('DELETE FROM partnerships WHERE id = $1 AND tree_id = $2', [id, treeId]);
    return { ok: true };
  });

  // ----- Fotos -----
  const ALLOWED: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

  // Límite de subidas por IP para que nadie llene el almacenamiento
  app.post('/api/uploads', { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Falta el archivo' });
    const ext = ALLOWED[file.mimetype];
    if (!ext) return reply.code(415).send({ error: 'Formato no permitido (usa WebP, JPG o PNG)' });
    const buf = await file.toBuffer();
    const url = await saveFile(`photos/${randomUUID()}.${ext}`, buf, file.mimetype, req.user!.id);
    return { url };
  });
}
