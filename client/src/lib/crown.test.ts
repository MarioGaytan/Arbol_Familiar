import { describe, expect, it } from 'vitest';
import { growCrown, type CrownAnchor } from './crown';

const row = (n: number, gap: number, y = 0): CrownAnchor[] =>
  Array.from({ length: n }, (_, i) => ({ x: i * gap, y, bottom: y + 110, w: 4 }));

describe('ramaje del modo árbol', () => {
  it('une las raíces de dos en dos: n raíces → 2n-2 ramas', () => {
    expect(growCrown(row(8, 400), { floor: 200, depth: 5000, trunk: 200 }).limbs).toHaveLength(14);
  });

  it('todas las bifurcaciones quedan debajo de la fila más baja', () => {
    const { limbs, trunk } = growCrown(row(6, 500), { floor: 300, depth: 400, trunk: 200 });
    for (const l of limbs) expect(l.from.y).toBeGreaterThanOrEqual(300);
    expect(trunk.baseY).toBeGreaterThan(trunk.forkY);
    expect(trunk.forkY).toBeLessThanOrEqual(300 + 400 + 1);
  });

  it('las ramas no salen casi horizontales aunque el árbol sea muy ancho', () => {
    const { limbs } = growCrown(row(10, 600), { floor: 200, depth: 5000, trunk: 200 });
    for (const l of limbs) {
      const dx = Math.abs(l.to.x - l.from.x);
      const dy = l.from.y - l.to.y;
      expect(dy).toBeGreaterThan(0);
      expect(dx / dy).toBeLessThan(3.5);
    }
  });

  it('una sola familia: el tronco sube directo', () => {
    const c = growCrown(row(1, 0), { floor: 200, depth: 400, trunk: 200 });
    expect(c.limbs).toHaveLength(1);
    expect(c.limbs[0].tip).toBeDefined();
  });
});
