/** Geometría de ramas: curvas que se afinan de un extremo a otro (como una rama real). */
export type Pt = { x: number; y: number };

export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 22): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return pts;
}

/** Curva con tangentes verticales (de una generación a la siguiente). */
export const verticalCurve = (s: Pt, t: Pt) => {
  const my = (s.y + t.y) / 2;
  return cubic(s, { x: s.x, y: my }, { x: t.x, y: my }, t);
};

/** Curva que sale en dirección radial desde el centro (0,0) y llega radialmente al destino. */
export const radialCurve = (s: Pt, t: Pt) => {
  const rs = Math.hypot(s.x, s.y);
  const rt = Math.hypot(t.x, t.y) || 1;
  const dt = { x: t.x / rt, y: t.y / rt };
  const ds = rs > 1 ? { x: s.x / rs, y: s.y / rs } : dt;
  const rm = (rs + rt) / 2;
  return cubic(s, { x: ds.x * rm, y: ds.y * rm }, { x: dt.x * rm, y: dt.y * rm }, t);
};

export const line = (s: Pt, t: Pt) => cubic(s, s, t, t, 2);

export const polyline = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** Contorno relleno de la curva con grosor que pasa de w1 a w2. */
export function taper(pts: Pt[], w1: number, w2: number) {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const w = (w1 + (w2 - w1) * (i / (n - 1))) / 2;
    left.push({ x: pts[i].x - ty * w, y: pts[i].y + tx * w });
    right.push({ x: pts[i].x + ty * w, y: pts[i].y - tx * w });
  }
  return `${polyline(left)} ${polyline(right.reverse()).replace('M', 'L')} Z`;
}
