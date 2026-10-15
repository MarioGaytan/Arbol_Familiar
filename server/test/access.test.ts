/** Cuentas, invitaciones, permisos por árbol, consentimiento (LFPDPPP) y enlace público. */
import { describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { LEGAL_VERSION } from '../src/privacy.js';
import { Client, newUser, PASSWORD, person, useApp } from './helpers.js';

const ctx = useApp();
const reg = (c: Client, extra: Record<string, unknown>) =>
  c.post('/api/auth/register', { name: 'Alguien', password: PASSWORD, acceptLegal: true, adult: true, ...extra });

describe('registro sólo por invitación', () => {
  it('la primera cuenta de la instalación es administradora', async () => {
    const me = await ctx.admin.get('/api/auth/me');
    expect(me.body.user.isAdmin).toBe(true);
    expect((await ctx.admin.get('/api/auth/setup')).body.needsSetup).toBe(false);
  });

  it('sin invitación no se puede crear cuenta', async () => {
    const r = await reg(new Client(ctx.app), { email: 'intruso@ejemplo.com' });
    expect(r.status).toBe(403);
  });

  it('una invitación sirve una sola vez', async () => {
    const { body } = await ctx.admin.post('/api/admin/invites', { hours: 1 });
    expect((await reg(new Client(ctx.app), { email: 'uno@ejemplo.com', invite: body.token })).status).toBe(200);
    expect((await reg(new Client(ctx.app), { email: 'dos@ejemplo.com', invite: body.token })).status).toBe(403);
  });

  it('una invitación para un correo no sirve para otro', async () => {
    const { body } = await ctx.admin.post('/api/admin/invites', { email: 'ana@ejemplo.com', hours: 1 });
    const r = await reg(new Client(ctx.app), { email: 'otra@ejemplo.com', invite: body.token });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/ana@ejemplo.com/);
  });

  it('exige aceptar el aviso de privacidad y ser mayor de edad', async () => {
    const { body } = await ctx.admin.post('/api/admin/invites', { hours: 1 });
    const c = new Client(ctx.app);
    expect((await reg(c, { email: 'x@ejemplo.com', invite: body.token, acceptLegal: false })).status).toBe(400);
    expect((await reg(c, { email: 'x@ejemplo.com', invite: body.token, adult: false })).status).toBe(400);
  });

  it('la contraseña incorrecta no inicia sesión', async () => {
    const r = await new Client(ctx.app).post('/api/auth/login', { email: 'admin@ejemplo.com', password: 'otra-cosa-123' });
    expect(r.status).toBe(401);
  });

  it('sólo un administrador entra al panel de administración', async () => {
    const u = await newUser(ctx, 'normal@ejemplo.com');
    expect((await u.get('/api/admin/users')).status).toBe(403);
    expect((await ctx.admin.get('/api/admin/users')).status).toBe(200);
  });

  it('negar el acceso cierra sus sesiones al instante', async () => {
    const u = await newUser(ctx, 'bloqueado@ejemplo.com');
    expect((await u.get('/api/trees')).status).toBe(200);
    await ctx.admin.patch(`/api/admin/users/${u.id}`, { status: 'blocked' });
    expect((await u.get('/api/trees')).status).toBe(401);
  });
});

describe('permisos por árbol', () => {
  it('sin sesión no hay API', async () => {
    expect((await new Client(ctx.app).get('/api/trees')).status).toBe(401);
  });

  it('quien no es miembro ni siquiera sabe que el árbol existe (404)', async () => {
    const tree = (await ctx.admin.post('/api/trees', { name: 'Privado' })).body.id;
    const extraño = await newUser(ctx, 'extrano@ejemplo.com');
    expect((await extraño.get(`/api/trees/${tree}`)).status).toBe(404);
    expect((await extraño.post(`/api/trees/${tree}/persons`, { person: { firstName: 'X' } })).status).toBe(404);
  });

  it('un editor puede editar pero no administrar quién tiene acceso', async () => {
    const tree = (await ctx.admin.post('/api/trees', { name: 'Compartido' })).body.id;
    const editor = await newUser(ctx, 'editor@ejemplo.com');
    expect((await ctx.admin.post(`/api/trees/${tree}/members`, { email: 'editor@ejemplo.com' })).status).toBe(200);
    expect((await editor.post(`/api/trees/${tree}/persons`, { person: { firstName: 'Nueva' } })).status).toBe(200);
    expect((await editor.get(`/api/trees/${tree}/sharing`)).status).toBe(403);
    expect((await editor.post(`/api/trees/${tree}/public-link`, { enabled: true })).status).toBe(403);
  });
});

describe('consentimiento versionado', () => {
  it('si cambia el aviso, exige volver a aceptarlo (428) antes de seguir', async () => {
    const u = await newUser(ctx, 'consentimiento@ejemplo.com');
    await pool.query(`UPDATE users SET legal_version = '2000-01-01' WHERE id = $1`, [u.id]);
    const r = await u.get('/api/trees');
    expect(r.status).toBe(428);
    expect(r.body.consentRequired).toBe(true);
    // Puede ejercer sus derechos ARCO aunque no acepte
    expect((await u.get('/api/me/export')).status).toBe(200);
    const ok = await u.post('/api/me/consent', { accept: true });
    expect(ok.body.version).toBe(LEGAL_VERSION);
    expect((await u.get('/api/trees')).status).toBe(200);
  });
});

describe('enlace público de solo lectura', () => {
  it('oculta fotos, fechas, lugares y notas de personas vivas', async () => {
    const tree = (await ctx.admin.post('/api/trees', { name: 'Público' })).body.id;
    await person(ctx.admin, tree, 'Viva', { birthDate: '2015-06-14', birthPlace: 'Puebla', notes: 'privado', photoUrl: '/uploads/x.webp' });
    await person(ctx.admin, tree, 'Fallecida', { birthDate: '1930', deathDate: '1999', birthPlace: 'Zacatecas', notes: 'privado' });
    const share = await ctx.admin.post(`/api/trees/${tree}/public-link`, { enabled: true });
    const token = share.body.publicToken as string;

    const pub = await new Client(ctx.app).get(`/api/public/${token}`);
    expect(pub.status).toBe(200);
    const byName = Object.fromEntries(pub.body.persons.map((p: { firstName: string }) => [p.firstName, p]));
    expect(byName.Viva).toMatchObject({ birthDate: null, birthPlace: null, photoUrl: null, notes: null, livingHidden: true });
    expect(byName.Fallecida).toMatchObject({ birthDate: '1930', birthPlace: 'Zacatecas', notes: null });
    expect(pub.body.tree.role).toBe('viewer');
  });

  it('desactivar el enlace lo invalida', async () => {
    const tree = (await ctx.admin.post('/api/trees', { name: 'Temporal' })).body.id;
    const on = await ctx.admin.post(`/api/trees/${tree}/public-link`, { enabled: true });
    const token = on.body.publicToken as string;
    await ctx.admin.post(`/api/trees/${tree}/public-link`, { enabled: false });
    expect((await new Client(ctx.app).get(`/api/public/${token}`)).status).toBe(404);
  });
});
