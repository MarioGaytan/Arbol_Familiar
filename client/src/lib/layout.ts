import dagre from '@dagrejs/dagre';
import type { LayoutMode, ParentChild, Partnership, Person } from '../types';
import { computeFamilies, NODE_H, NODE_W } from './graph';

const GAP_X = 44;
export const ROW_H = NODE_H + 120;

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V) {
  if (!m.has(k)) m.set(k, []);
  m.get(k)!.push(v);
}

/** Generación de cada persona: hijos debajo de sus padres y parejas en la misma fila. */
export function computeGenerations(persons: Person[], pc: ParentChild[], partnerships: Partnership[]) {
  const gen = new Map(persons.map((p) => [p.id, 0]));
  const hasParents = new Set(pc.map((r) => r.childId));
  const kids = new Map<string, string[]>();
  for (const r of pc) pushTo(kids, r.parentId, r.childId);

  const maxIter = persons.length * 2 + 10;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    const raise = (id: string, v: number) => {
      if ((gen.get(id) ?? 0) < v) {
        gen.set(id, v);
        changed = true;
      }
    };
    for (const r of pc) raise(r.childId, gen.get(r.parentId)! + 1);
    for (const p of partnerships) {
      const m = Math.max(gen.get(p.personA)!, gen.get(p.personB)!);
      raise(p.personA, m);
      raise(p.personB, m);
    }
    // Personas sin padres registrados: acercarlas a sus hijos en vez de "flotar" arriba
    for (const p of persons) {
      if (hasParents.has(p.id)) continue;
      const k = kids.get(p.id);
      if (k?.length) raise(p.id, Math.min(...k.map((c) => gen.get(c)!)) - 1);
    }
    if (!changed) break;
  }
  const min = Math.min(0, ...gen.values());
  for (const [id, v] of gen) gen.set(id, v - min);
  return gen;
}

/** Organización automática: dagre decide el orden horizontal; cada fila es una generación. */
export function autoLayout(persons: Person[], pc: ParentChild[], partnerships: Partnership[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: GAP_X, ranksep: 40, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const p of persons) g.setNode(p.id, { width: NODE_W, height: NODE_H });

  for (const f of computeFamilies(pc, partnerships)) {
    if (f.parents.length === 2) {
      g.setNode(f.id, { width: 8, height: 8 });
      for (const p of f.parents) g.setEdge(p, f.id, { weight: 8 });
      for (const c of f.children) g.setEdge(f.id, c.id, { weight: 2 });
    } else {
      for (const c of f.children) g.setEdge(f.parents[0], c.id, { minlen: 2, weight: 2 });
    }
  }
  dagre.layout(g);

  const dagreX = new Map(persons.map((p) => [p.id, g.node(p.id).x]));
  const gen = computeGenerations(persons, pc, partnerships);

  // --- Unidades: cada pareja (o cadena de parejas) en la misma fila se mueve como un bloque ---
  const ufParent = new Map(persons.map((p) => [p.id, p.id]));
  const find = (id: string): string => (ufParent.get(id) === id ? id : find(ufParent.get(id)!));
  for (const p of partnerships) {
    if (gen.get(p.personA) === gen.get(p.personB)) ufParent.set(find(p.personA), find(p.personB));
  }
  const groups = new Map<string, string[]>();
  for (const p of persons) pushTo(groups, find(p.id), p.id);

  interface Unit { members: string[]; x: number; w: number }
  const rows = new Map<number, Unit[]>();
  const unitOf = new Map<string, Unit>();
  for (const members of groups.values()) {
    members.sort((a, b) => dagreX.get(a)! - dagreX.get(b)!);
    const w = members.length * NODE_W + (members.length - 1) * GAP_X;
    const meanX = members.reduce((s, m) => s + dagreX.get(m)!, 0) / members.length;
    const u: Unit = { members, x: meanX - w / 2, w };
    pushTo(rows, gen.get(members[0]) ?? 0, u);
    for (const m of members) unitOf.set(m, u);
  }

  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const r of pc) {
    pushTo(parentsOf, r.childId, r.parentId);
    pushTo(childrenOf, r.parentId, r.childId);
  }
  const offset = (id: string) => unitOf.get(id)!.members.indexOf(id) * (NODE_W + GAP_X);
  const centerX = (id: string) => unitOf.get(id)!.x + offset(id) + NODE_W / 2;
  const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

  /** Coloca las unidades lo más cerca posible de su x deseada, sin encimarse. */
  const pack = (units: Unit[], desired: Map<Unit, number>) => {
    units.sort((a, b) => desired.get(a)! + a.w / 2 - (desired.get(b)! + b.w / 2));
    let right = -Infinity;
    for (const u of units) {
      u.x = Math.max(desired.get(u)!, right + GAP_X * 1.5);
      right = u.x + u.w;
    }
    const shift = avg(units.map((u) => desired.get(u)! - u.x));
    for (const u of units) u.x += shift;
  };

  /** Orden dentro de la pareja: cada quien del lado de sus padres; quien "se casó con" la familia, hacia afuera. */
  const orderMembers = (u: Unit) => {
    if (u.members.length < 2) return;
    const key = new Map<string, number>();
    for (const m of u.members) if (parentsOf.get(m)?.length) key.set(m, avg(parentsOf.get(m)!.map(centerX)));
    if (key.size === u.members.length) {
      u.members.sort((a, b) => key.get(a)! - key.get(b)!);
    } else if (u.members.length === 2 && key.size === 1) {
      const blood = u.members.find((m) => key.has(m))!;
      const other = u.members.find((m) => m !== blood)!;
      const sibs = [...new Set(parentsOf.get(blood)!.flatMap((p) => childrenOf.get(p) ?? []))].filter(
        (s) => s !== blood && unitOf.get(s) !== u && gen.get(s) === gen.get(blood),
      );
      if (sibs.length) {
        const sibMean = avg(sibs.map(centerX));
        u.members = sibMean <= u.x + u.w / 2 ? [blood, other] : [other, blood];
      }
    }
  };

  const rowKeys = [...rows.keys()].sort((a, b) => a - b);
  const down = () => {
    for (const r of rowKeys.slice(1)) {
      const units = rows.get(r)!;
      units.forEach(orderMembers);
      const desired = new Map<Unit, number>();
      for (const u of units) {
        const wants = u.members
          .filter((m) => parentsOf.get(m)?.length)
          .map((m) => avg(parentsOf.get(m)!.map(centerX)) - offset(m) - NODE_W / 2);
        desired.set(u, wants.length ? avg(wants) : u.x);
      }
      pack(units, desired);
    }
  };
  const up = () => {
    for (const r of [...rowKeys].reverse().slice(1)) {
      const units = rows.get(r)!;
      const desired = new Map<Unit, number>();
      for (const u of units) {
        const kids = [...new Set(u.members.flatMap((m) => childrenOf.get(m) ?? []))];
        desired.set(u, kids.length ? avg(kids.map(centerX)) - u.w / 2 : u.x);
      }
      pack(units, desired);
    }
  };
  for (let i = 0; i < 4; i++) {
    down();
    up();
  }
  down();

  const out = new Map<string, { x: number; y: number }>();
  for (const [row, units] of rows) {
    for (const u of units) {
      u.members.forEach((m, i) => out.set(m, { x: Math.round(u.x + i * (NODE_W + GAP_X)), y: row * ROW_H }));
    }
  }
  return out;
}

/** Busca un hueco libre cerca de (x, y) avanzando horizontalmente. */
export function freeSpot(x: number, y: number, persons: Person[], dir: 1 | -1 = 1) {
  let cx = x;
  for (let i = 0; i < 200; i++) {
    const hit = persons.some(
      (p) =>
        p.posX !== null &&
        p.posY !== null &&
        Math.abs(p.posX - cx) < NODE_W + 20 &&
        Math.abs(p.posY - y) < NODE_H + 20,
    );
    if (!hit) return { x: cx, y };
    cx += dir * (NODE_W + GAP_X);
  }
  return { x: cx, y };
}

/** Radio mínimo del primer anillo y separación entre anillos en modo radial. */
const RING = NODE_H + 110;
const CLEARANCE = Math.hypot(NODE_W, NODE_H) + 24;

/**
 * Convierte el orden por generaciones a coordenadas polares: la generación más antigua en el centro
 * y cada generación siguiente en un anillo hacia afuera (como los anillos de un tronco).
 */
function toRadial(pos: Map<string, { x: number; y: number }>) {
  const items = [...pos].map(([id, p]) => ({ id, cx: p.x + NODE_W / 2, row: Math.round(p.y / ROW_H) }));
  if (!items.length) return pos;
  const minX = Math.min(...items.map((i) => i.cx));
  const maxX = Math.max(...items.map((i) => i.cx));
  const midX = (minX + maxX) / 2;
  const span = maxX - minX + NODE_W + GAP_X * 3; // deja un hueco en la "costura" del círculo
  const kMax = (2 * Math.PI) / span; // con este valor el árbol ocuparía el círculo completo

  const rows = new Map<number, typeof items>();
  for (const i of items) pushTo(rows, i.row, i);
  const keys = [...rows.keys()].sort((a, b) => a - b);
  for (const k of keys) rows.get(k)!.sort((a, b) => a.cx - b.cx);
  const centered = rows.get(keys[0])!.length <= 2; // la pareja más antigua va al centro
  const minDx = (row: typeof items) => {
    let m = Infinity;
    for (let j = 1; j < row.length; j++) m = Math.min(m, row[j].cx - row[j - 1].cx);
    return m;
  };

  // Abanico de ~210° que se abre hacia arriba como la copa de un árbol;
  // cada anillo se aleja del centro lo necesario para que las tarjetas no se encimen
  const k = Math.min(kMax, (1.17 * Math.PI) / span);
  const radii: number[] = [];
  let prev = centered ? 0 : -RING * 0.2;
  keys.forEach((row, idx) => {
    if (idx === 0 && centered) return radii.push(0);
    const d = minDx(rows.get(row)!);
    const need = Number.isFinite(d) ? CLEARANCE / (d * k) : 0;
    prev = Math.max(need, prev + RING);
    radii.push(prev);
  });

  const out = new Map<string, { x: number; y: number }>();
  keys.forEach((row, idx) => {
    const r0 = rows.get(row)!;
    if (idx === 0 && centered) {
      r0.forEach((it, j) =>
        out.set(it.id, { x: Math.round(-NODE_W / 2 + (j - (r0.length - 1) / 2) * (NODE_W + GAP_X)), y: -NODE_H / 2 }),
      );
      return;
    }
    for (const it of r0) {
      const th = (it.cx - midX) * k; // 0 = arriba: la copa se abre hacia arriba
      out.set(it.id, { x: Math.round(radii[idx] * Math.sin(th) - NODE_W / 2), y: Math.round(-radii[idx] * Math.cos(th) - NODE_H / 2) });
    }
  });
  return out;
}

/** Posiciones según la forma elegida para el árbol. */
export function layoutFor(mode: LayoutMode, persons: Person[], pc: ParentChild[], partnerships: Partnership[]) {
  const pos = autoLayout(persons, pc, partnerships);
  if (mode === 'tree') {
    const maxY = Math.max(0, ...[...pos.values()].map((p) => p.y));
    for (const [id, p] of pos) pos.set(id, { x: p.x, y: maxY - p.y });
  }
  if (mode === 'radial') return toRadial(pos);
  return pos;
}

/** Dónde poner a un familiar nuevo según la forma del árbol. */
export function relativeSpot(
  mode: LayoutMode,
  kind: 'parent' | 'child' | 'partner' | 'sibling',
  of: { x: number; y: number },
  persons: Person[],
) {
  if (mode === 'radial') {
    const cx = of.x + NODE_W / 2;
    const cy = of.y + NODE_H / 2;
    const len = Math.hypot(cx, cy) || 1;
    const [ux, uy] = [cx / len, cy / len]; // hacia afuera
    const [px, py] = [-uy, ux]; // tangente
    const d = kind === 'child' ? [ux * RING, uy * RING] : kind === 'parent' ? [-ux * RING, -uy * RING] : [px * (NODE_W + GAP_X), py * (NODE_W + GAP_X)];
    let cand = { x: Math.round(of.x + d[0]), y: Math.round(of.y + d[1]) };
    for (let i = 0; i < 40; i++) {
      const hit = persons.some((p) => p.posX !== null && p.posY !== null && Math.abs(p.posX - cand.x) < NODE_W + 10 && Math.abs(p.posY - cand.y) < NODE_H + 10);
      if (!hit) break;
      cand = { x: Math.round(cand.x + px * (NODE_W + GAP_X)), y: Math.round(cand.y + py * (NODE_W + GAP_X)) };
    }
    return cand;
  }
  const dir = mode === 'tree' ? -1 : 1; // en modo árbol los hijos van ARRIBA
  const dy = kind === 'child' ? ROW_H * dir : kind === 'parent' ? -ROW_H * dir : 0;
  return freeSpot(of.x + (kind === 'parent' ? -(NODE_W + GAP_X) / 2 : kind === 'child' ? 0 : NODE_W + GAP_X), of.y + dy, persons);
}
