/**
 * Ramaje del modo árbol: en vez de abrir todas las ramas desde un solo punto (que con árboles anchos
 * deja ramas casi horizontales y un tronco chato), las raíces de cada linaje se agrupan por cercanía y
 * se unen de dos en dos, como un árbol real: cada bifurcación queda más abajo cuanto más separadas
 * están sus ramas, y el grosor crece con el número de familias que sostiene.
 */
export interface CrownAnchor {
  x: number;
  /** punto donde termina la rama (línea de la pareja o borde de la tarjeta) */
  y: number;
  /** borde inferior de las tarjetas: hasta ahí la rama sube recta */
  bottom: number;
  /** grosor de la rama al llegar */
  w: number;
}

export interface Limb {
  from: { x: number; y: number };
  to: { x: number; y: number };
  w1: number;
  w2: number;
  /** sólo en las ramas finales: tramo recto desde `to` hasta la pareja */
  tip?: { x: number; y: number };
}

export interface Crown {
  trunk: { x: number; forkY: number; baseY: number; w: number };
  limbs: Limb[];
}

interface Cluster {
  x: number;
  y: number;
  n: number;
  left: number;
  right: number;
  kids: Cluster[];
  anchor?: CrownAnchor;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Une recursivamente por el hueco horizontal más grande (así cada linaje queda en su propia rama). */
function build(list: CrownAnchor[], floor: number): Cluster {
  if (list.length === 1) {
    const a = list[0];
    return { x: a.x, y: a.bottom, n: 1, left: a.x, right: a.x, kids: [], anchor: a };
  }
  let cut = 1;
  let best = -Infinity;
  for (let i = 1; i < list.length; i++) {
    // Preferir cortes cercanos al centro cuando los huecos son parecidos: ramas más equilibradas
    const balance = 1 - Math.abs(i / list.length - 0.5);
    const score = (list[i].x - list[i - 1].x) * (0.6 + balance);
    if (score > best) {
      best = score;
      cut = i;
    }
  }
  const a = build(list.slice(0, cut), floor);
  const b = build(list.slice(cut), floor);
  const n = a.n + b.n;
  const span = b.x - a.x;
  // Cuanto más separadas las ramas, más abajo se bifurcan (ángulo de ~35-45°, no horizontal)
  const drop = clamp(span * 0.45, 70, 1800);
  return {
    x: (a.x * a.n + b.x * b.n) / n,
    // Nunca por encima de la fila más baja: si no, la bifurcación quedaría entre tarjetas de otro linaje
    y: Math.max(Math.max(a.y, b.y) + drop, floor),
    n,
    left: a.left,
    right: b.right,
    kids: [a, b],
  };
}

export interface CrownOptions {
  /** y mínima de las bifurcaciones (debajo de la tarjeta más baja) */
  floor: number;
  /** alto máximo del ramaje bajo las tarjetas: si crece sin límite el árbol parece una copa vacía */
  depth: number;
  /** largo del tronco */
  trunk: number;
}

export function growCrown(anchors: CrownAnchor[], o: CrownOptions): Crown {
  const sorted = [...anchors].sort((p, q) => p.x - q.x);
  const root = build(sorted, o.floor);
  // Comprimir las bifurcaciones al alto disponible conservando su orden
  const raw = root.y - o.floor;
  if (!root.anchor && raw > o.depth) {
    const k = o.depth / raw;
    const squash = (c: Cluster) => {
      if (c.anchor) return;
      c.y = o.floor + (c.y - o.floor) * k;
      c.kids.forEach(squash);
    };
    squash(root);
  }
  const total = root.n;
  const span = root.right - root.left;
  // El grosor acompaña al tamaño del árbol: si no, en árboles anchos el tronco parece un palito
  const trunkW = clamp(Math.max(60 + 28 * Math.sqrt(total), span * 0.06), 64, 340);
  const limbW = (n: number) => Math.max(8, trunkW * 0.85 * Math.pow(n / total, 0.4));
  // Las ramas finales también conservan cuerpo hasta llegar a la pareja (no se vuelven un hilo de golpe)
  const widthFor = (c: Cluster) => (c.anchor ? Math.max(c.anchor.w, Math.min(34, limbW(1) * 0.45)) : limbW(c.n));

  // Una sola familia: el tronco sube directo a ella
  const forkY = root.anchor ? root.y + 120 : root.y;
  const baseY = forkY + o.trunk;

  const limbs: Limb[] = [];
  const walk = (c: Cluster, from: { x: number; y: number }, w1: number) => {
    const w2 = widthFor(c);
    const tip = c.anchor && c.anchor.y < c.y - 1 ? { x: c.anchor.x, y: c.anchor.y } : undefined;
    limbs.push({ from, to: { x: c.x, y: c.y }, w1, w2, tip });
    for (const k of c.kids) walk(k, { x: c.x, y: c.y }, w2);
  };
  if (root.anchor) walk(root, { x: root.x, y: forkY }, trunkW * 0.75);
  else for (const k of root.kids) walk(k, { x: root.x, y: root.y }, widthFor(root));

  return { trunk: { x: root.x, forkY, baseY, w: trunkW }, limbs };
}
