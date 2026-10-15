/**
 * Reglas de integridad que viven en PostgreSQL (triggers, CHECK y FKs compuestas por árbol).
 * Se prueban a través de la API para cubrir también la traducción del error a un mensaje amable.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { person, useApp } from './helpers.js';

const ctx = useApp();
let tree: string;
let abuelo: string, padre: string, hijo: string;

beforeAll(async () => {
  const r = await ctx.admin.post('/api/trees', { name: 'Integridad' });
  tree = r.body.id;
  abuelo = await person(ctx.admin, tree, 'Abuelo', { gender: 'male' });
  padre = await person(ctx.admin, tree, 'Padre', { gender: 'male', parents: [{ id: abuelo }] });
  hijo = await person(ctx.admin, tree, 'Hijo', { gender: 'male', parents: [{ id: padre }] });
});

const link = (parentId: string, childId: string, kind?: string) =>
  ctx.admin.post(`/api/trees/${tree}/parent-child`, { parentId, childId, kind });

describe('parentescos imposibles', () => {
  it('rechaza ciclos: nadie puede ser su propio ancestro', async () => {
    const r = await link(hijo, abuelo);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/ciclo/);
  });

  it('rechaza que alguien sea su propio padre', async () => {
    const r = await link(padre, padre);
    expect(r.status).toBe(400);
  });

  it('no permite un tercer padre biológico, pero sí uno adoptivo', async () => {
    const madre = await person(ctx.admin, tree, 'Madre', { gender: 'female' });
    expect((await link(madre, hijo)).status).toBe(200);
    const otro = await person(ctx.admin, tree, 'Otro');
    const r = await link(otro, hijo);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/dos padres biológicos/);
    expect((await link(otro, hijo, 'adoptive')).status).toBe(200);
  });

  it('rechaza la misma relación dos veces', async () => {
    const r = await link(abuelo, padre);
    expect(r.status).toBe(409);
  });

  it('un padre y su hijo no pueden ser pareja', async () => {
    const r = await ctx.admin.post(`/api/trees/${tree}/partnerships`, { personA: padre, personB: hijo });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no pueden ser pareja/);
  });
});

describe('datos de cada persona', () => {
  it('la defunción no puede ser anterior al nacimiento', async () => {
    const r = await ctx.admin.post(`/api/trees/${tree}/persons`, {
      person: { firstName: 'Fechas', birthDate: '1990', deathDate: '1980' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/anterior al nacimiento/);
  });

  it('valida el formato de fechas parciales', async () => {
    const r = await ctx.admin.post(`/api/trees/${tree}/persons`, { person: { firstName: 'X', birthDate: '1990-13' } });
    expect(r.status).toBe(400);
  });

  it('guarda y devuelve la precisión de la fecha (año, mes o día)', async () => {
    const id = await person(ctx.admin, tree, 'Precisa', { birthDate: '1950-03', deathDate: '2001' });
    const t = await ctx.admin.get(`/api/trees/${tree}`);
    const p = t.body.persons.find((x: { id: string }) => x.id === id);
    expect(p.birthDate).toBe('1950-03');
    expect(p.deathDate).toBe('2001');
  });
});

describe('aislamiento entre árboles', () => {
  it('no se puede vincular a una persona de otro árbol', async () => {
    const otro = (await ctx.admin.post('/api/trees', { name: 'Otro árbol' })).body.id;
    const ajena = await person(ctx.admin, otro, 'Ajena');
    const sinPadres = await person(ctx.admin, tree, 'Sin padres');
    const r = await link(ajena, sinPadres);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/otro árbol/);
  });

  it('borrar a una persona borra también sus vínculos', async () => {
    const tmp = await person(ctx.admin, tree, 'Temporal', { parents: [{ id: abuelo }] });
    await ctx.admin.post(`/api/trees/${tree}/persons/delete`, { ids: [tmp] });
    const t = await ctx.admin.get(`/api/trees/${tree}`);
    expect(t.body.parentChild.some((r: { childId: string }) => r.childId === tmp)).toBe(false);
  });

  it('la importación es todo o nada: un ciclo cancela el árbol completo', async () => {
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    const before = (await ctx.admin.get('/api/trees')).body.length;
    const r = await ctx.admin.post('/api/trees/import', {
      name: 'Importado roto',
      persons: [{ id: a, firstName: 'A' }, { id: b, firstName: 'B' }],
      parentChild: [{ parentId: a, childId: b, kind: 'biological' }, { parentId: b, childId: a, kind: 'biological' }],
    });
    expect(r.status).toBe(400);
    expect((await ctx.admin.get('/api/trees')).body.length).toBe(before);
  });
});
