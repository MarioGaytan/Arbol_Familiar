import { describe, expect, it } from 'vitest';
import { family } from '../test/family';
import { bloodLabel, buildIndex, computeRelations, findPath } from './kinship';

describe('computeRelations: parentesco respecto a la persona central', () => {
  const f = family();
  const rel = computeRelations('yo', f.persons, buildIndex(f.parentChild, f.partnerships));

  it.each([
    ['yo', 'Persona central'],
    ['papa', 'Padre'],
    ['mama', 'Madre'],
    ['abuelo', 'Abuelo'],
    ['abuela', 'Abuela'],
    ['hermana', 'Hermana'],
    ['medio', 'Medio hermano'],
    ['tio', 'Tío'],
    ['primo', 'Primo'],
    ['hijo', 'Hijo'],
    ['sobrino', 'Sobrino'],
    ['primo2', 'Sobrino/a segundo/a'], // hijo de un primo, género sin dato
    ['padrastro', 'Padrastro'],
  ])('%s → %s (sangre)', (id, label) => {
    expect(rel.get(id)).toBe(label);
  });

  it.each([
    ['esposa', 'Esposa'],
    ['suegro', 'Suegro'],
    ['suegra', 'Suegra'],
    ['cunado', 'Cuñado'],
    ['tia', 'Tía política'],
    ['exesposa', 'Madrastra'], // pareja del padre que no es la madre
  ])('%s → %s (políticos)', (id, label) => {
    expect(rel.get(id)).toBe(label);
  });

  it('sin persona central no calcula nada', () => {
    expect(computeRelations(null, f.persons, buildIndex(f.parentChild, f.partnerships)).size).toBe(0);
  });

  it('el resultado cambia al cambiar la persona central', () => {
    const desdePrimo = computeRelations('primo', f.persons, buildIndex(f.parentChild, f.partnerships));
    expect(desdePrimo.get('tio')).toBe('Padre');
    expect(desdePrimo.get('papa')).toBe('Tío');
    expect(desdePrimo.get('yo')).toBe('Prima');
  });
});

describe('bloodLabel', () => {
  it.each([
    [3, 0, 'male', 'Bisabuelo'],
    [4, 0, 'female', 'Tatarabuela'],
    [0, 3, 'female', 'Bisnieta'],
    [3, 1, 'male', 'Tío abuelo'],
    [1, 3, 'female', 'Sobrina nieta'],
    [3, 3, 'male', 'Primo segundo'],
    [4, 4, 'female', 'Prima tercera'],
    [3, 2, 'male', 'Tío segundo'],
    [2, 1, 'unknown', 'Tío/a'],
    [9, 0, 'male', 'Ancestro (9 gen.)'],
  ] as const)('subir %i y bajar %i (%s) → %s', (up, down, gender, label) => {
    expect(bloodLabel(up, down, gender)).toBe(label);
  });
});

describe('findPath: rastreo entre dos personas', () => {
  const f = family();
  const idx = buildIndex(f.parentChild, f.partnerships);

  it('encuentra el camino más corto por padres, hijos y parejas', () => {
    const path = findPath('yo', 'primo', idx);
    expect(path[0]).toBe('yo');
    expect(path.at(-1)).toBe('primo');
    expect(path).toHaveLength(5); // yo → papá → abuelo/a → tío → primo
  });

  it('cruza por la pareja para llegar a la familia política', () => {
    expect(findPath('yo', 'suegro', idx)).toEqual(['yo', 'esposa', 'suegro']);
  });

  it('devuelve vacío si no hay conexión', () => {
    expect(findPath('yo', 'nadie', idx)).toEqual([]);
  });
});
