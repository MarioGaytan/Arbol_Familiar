import { describe, expect, it } from 'vitest';
import { family } from '../test/family';
import { exportGedcom, parseGedcom } from './gedcom';

const encode = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('GEDCOM', () => {
  const f = family();
  const snapshot = { persons: Object.values(f.persons), parentChild: f.parentChild, partnerships: f.partnerships };
  const ged = exportGedcom(snapshot, 'Familia Prueba', 'https://ejemplo.com');

  it('genera un archivo GEDCOM 5.5.1 en UTF-8', () => {
    expect(ged).toMatch(/^0 HEAD/);
    expect(ged).toContain('2 VERS 5.5.1');
    expect(ged).toContain('1 CHAR UTF-8');
    expect(ged.trimEnd()).toMatch(/0 TRLR$/);
  });

  it('exportar e importar conserva personas, fechas y vínculos', () => {
    const back = parseGedcom(encode(ged), 'prueba.ged');
    expect(back.persons).toHaveLength(snapshot.persons.length);

    const byName = new Map(back.persons.map((p) => [p.firstName, p]));
    const yo = byName.get('yo')!;
    expect(yo.lastName).toBe('Prueba');
    expect(yo.gender).toBe('female');
    expect(yo.birthDate).toBe('1984-08-15');
    expect(byName.get('abuelo')!.deathDate).toBe('2000');

    const name = (id: string) => back.persons.find((p) => p.id === id)!.firstName;
    const pairs = (rows: { parentId: string; childId: string; kind: string }[]) =>
      rows.map((r) => `${name(r.parentId)}→${name(r.childId)}:${r.kind}`).sort();
    const original = f.parentChild.map((r) => `${r.parentId}→${r.childId}:${r.kind}`).sort();
    expect(pairs(back.parentChild)).toEqual(original); // incluye padrastro (step) e hijos de un solo padre
    // Parejas: las mismas, más suegro+suegra (en GEDCOM los dos padres de una familia forman pareja)
    const couples = (rows: { personA: string; personB: string; kind: string }[], n: (id: string) => string) =>
      rows.map((r) => [n(r.personA), n(r.personB)].sort().join('+') + ':' + r.kind).sort();
    const imported = couples(back.partnerships, name);
    expect(imported.filter((c) => !c.startsWith('suegra+suegro'))).toEqual(couples(f.partnerships, (id) => id));
    expect(imported.filter((c) => c.startsWith('suegra+suegro'))).toHaveLength(1);
  });

  it('reconoce la separación escrita por otros programas (EVEN TYPE)', () => {
    const txt = [
      '0 HEAD', '0 @I1@ INDI', '1 NAME A /X/', '0 @I2@ INDI', '1 NAME B /Y/',
      '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 EVEN', '2 TYPE Separación', '0 TRLR',
    ].join('\n');
    expect(parseGedcom(encode(txt), 'x.ged').partnerships[0].kind).toBe('separated');
  });

  it('lee archivos antiguos en Windows-1252 (acentos)', () => {
    const latin1 = new Uint8Array([...'0 HEAD\n0 @I1@ INDI\n1 NAME Jos'].map((c) => c.charCodeAt(0)).concat([0xe9], [...' /Mu'].map((c) => c.charCodeAt(0)), [0xf1], [...'oz/\n0 TRLR\n'].map((c) => c.charCodeAt(0))));
    const r = parseGedcom(latin1.buffer, 'viejo.ged');
    expect(r.persons[0].firstName).toBe('José');
    expect(r.persons[0].lastName).toBe('Muñoz');
  });
});
