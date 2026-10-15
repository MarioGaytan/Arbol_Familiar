import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';

export const PASSWORD = 'contraseña-de-prueba';

let ip = 1;

/** Un "navegador" de prueba: guarda la cookie de sesión entre peticiones. */
export class Client {
  cookie = '';
  // Cada cliente con su propia IP para no chocar con el límite de intentos de login
  readonly ip = `10.0.0.${ip++}`;
  constructor(private app: FastifyInstance) {}

  async req<T = any>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      payload: body as object | undefined,
      headers: this.cookie ? { cookie: this.cookie } : {},
      remoteAddress: this.ip,
    });
    const set = res.headers['set-cookie'];
    const sid = [set].flat().find((c) => c?.startsWith('sid='));
    if (sid) this.cookie = sid.split(';')[0];
    return { status: res.statusCode, body: res.body ? res.json() : (undefined as T) };
  }
  get = <T = any>(url: string) => this.req<T>('GET', url);
  post = <T = any>(url: string, body: unknown = {}) => this.req<T>('POST', url, body);
  patch = <T = any>(url: string, body: unknown) => this.req<T>('PATCH', url, body);
  del = <T = any>(url: string) => this.req<T>('DELETE', url);
}

/** Levanta la app para un archivo de pruebas, con la base vacía (sin usuarios ni árboles). */
export function useApp() {
  const ctx = {} as { app: FastifyInstance; admin: Client };
  beforeAll(async () => {
    await pool.query('TRUNCATE users, trees, registration_invites, uploads CASCADE');
    ctx.app = await buildApp({ logger: false });
    await ctx.app.ready();
    ctx.admin = new Client(ctx.app);
    const r = await ctx.admin.post('/api/auth/register', {
      name: 'Admin Prueba', email: 'admin@ejemplo.com', password: PASSWORD, acceptLegal: true, adult: true,
    });
    if (r.status !== 200) throw new Error(`No se pudo crear el admin: ${JSON.stringify(r.body)}`);
  });
  afterAll(async () => {
    await ctx.app?.close();
    await pool.end();
  });
  return ctx;
}

/** Crea otra cuenta usando una invitación del administrador. */
export async function newUser(ctx: { app: FastifyInstance; admin: Client }, email: string) {
  const inv = await ctx.admin.post('/api/admin/invites', { email, hours: 24 });
  const u = new Client(ctx.app);
  const r = await u.post('/api/auth/register', {
    name: email.split('@')[0], email, password: PASSWORD, invite: inv.body.token, acceptLegal: true, adult: true,
  });
  if (r.status !== 200) throw new Error(`No se pudo registrar ${email}: ${JSON.stringify(r.body)}`);
  return Object.assign(u, { id: r.body.user.id as string });
}

/** Crea una persona en el árbol y devuelve su id. */
export async function person(c: Client, treeId: string, firstName: string, extra: Record<string, unknown> = {}) {
  const { parents = [], ...p } = extra as { parents?: { id: string; kind?: string }[] };
  const r = await c.post(`/api/trees/${treeId}/persons`, { person: { firstName, ...p }, parents });
  if (r.status !== 200) throw new Error(`No se pudo crear ${firstName}: ${JSON.stringify(r.body)}`);
  return r.body.person.id as string;
}
