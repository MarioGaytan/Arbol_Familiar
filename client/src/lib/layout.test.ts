import { describe, expect, it } from 'vitest';
import { family } from '../test/family';
import { NODE_H, NODE_W } from './graph';
import { layoutFor } from './layout';

const f = family();
const persons = Object.values(f.persons);

const overlaps = (pos: Map<string, { x: number; y: number }>) => {
  const list = [...pos.entries()];
  const bad: string[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const [a, p] = list[i], [b, q] = list[j];
      if (Math.abs(p.x - q.x) < NODE_W && Math.abs(p.y - q.y) < NODE_H) bad.push(`${a}/${b}`);
    }
  return bad;
};

describe('orden automático', () => {
  it.each(['generations', 'tree', 'radial'] as const)('modo %s: todas las personas tienen lugar y ninguna tarjeta se encima', (mode) => {
    const pos = layoutFor(mode, persons, f.parentChild, f.partnerships);
    expect(pos.size).toBe(persons.length);
    for (const p of pos.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(overlaps(pos)).toEqual([]);
  });

  it('Generaciones: los padres quedan arriba de sus hijos y la pareja en la misma fila', () => {
    const pos = layoutFor('generations', persons, f.parentChild, f.partnerships);
    for (const r of f.parentChild) expect(pos.get(r.parentId)!.y).toBeLessThan(pos.get(r.childId)!.y);
    expect(pos.get('yo')!.y).toBe(pos.get('esposa')!.y);
  });

  it('Árbol: los ancestros quedan abajo, junto al tronco, y los descendientes arriba', () => {
    const gen = layoutFor('generations', persons, f.parentChild, f.partnerships);
    const tree = layoutFor('tree', persons, f.parentChild, f.partnerships);
    // Mismo orden horizontal, filas invertidas
    expect(tree.get('abuelo')!.y).toBeGreaterThan(tree.get('hijo')!.y);
    expect(tree.get('abuelo')!.x).toBe(gen.get('abuelo')!.x);
  });
});
