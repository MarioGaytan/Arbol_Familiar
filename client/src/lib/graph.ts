import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { growCrown, type Crown } from './crown';
import type { EdgeStyle, LayoutMode, ParentChild, ParentKind, Partnership, Person } from '../types';

export const NODE_W = 180;
export const NODE_H = 214;

/** Una "familia" = 1 o 2 progenitores + sus hijos en común. Las parejas se unen con un nodo invisible (unión). */
export interface Family {
  id: string;
  parents: string[];
  children: { id: string; kind: ParentKind }[];
  partnership?: Partnership;
}

export function computeFamilies(parentChild: ParentChild[], partnerships: Partnership[]): Family[] {
  const fams = new Map<string, Family>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const partnerSet = new Map<string, Partnership>();
  for (const p of partnerships) {
    const key = pairKey(p.personA, p.personB);
    partnerSet.set(key, p);
    fams.set(key, { id: `u:${key}`, parents: [p.personA, p.personB], children: [], partnership: p });
  }
  const parentsOf = new Map<string, ParentChild[]>();
  for (const r of parentChild) {
    if (!parentsOf.has(r.childId)) parentsOf.set(r.childId, []);
    parentsOf.get(r.childId)!.push(r);
  }

  for (const [childId, rels] of parentsOf) {
    const remaining = [...rels];
    // Emparejar progenitores que son pareja (o si el hijo tiene exactamente dos)
    let paired = true;
    while (paired) {
      paired = false;
      outer: for (let i = 0; i < remaining.length; i++) {
        for (let j = i + 1; j < remaining.length; j++) {
          const a = remaining[i].parentId;
          const b = remaining[j].parentId;
          const key = pairKey(a, b);
          if (partnerSet.has(key) || rels.length === 2) {
            if (!fams.has(key)) fams.set(key, { id: `u:${key}`, parents: [a, b].sort(), children: [] });
            const kind = remaining[i].kind !== 'biological' ? remaining[i].kind : remaining[j].kind;
            fams.get(key)!.children.push({ id: childId, kind });
            remaining.splice(j, 1);
            remaining.splice(i, 1);
            paired = true;
            break outer;
          }
        }
      }
    }
    for (const r of remaining) {
      const key = `s:${r.parentId}`;
      if (!fams.has(key)) fams.set(key, { id: key, parents: [r.parentId], children: [] });
      fams.get(key)!.children.push({ id: childId, kind: r.kind });
    }
  }
  return [...fams.values()];
}

export interface PersonNodeData extends Record<string, unknown> {
  person: Person;
  relation?: string;
  isRoot: boolean;
  highlight: boolean;
  dim: boolean;
}
export interface UnionNodeData extends Record<string, unknown> {
  parents: string[];
  mode: LayoutMode;
  /** grosor de la "rama" vertical de la pareja */
  w: number;
  /** dibujar como rama (se afina y se ensancha en el nudo de la pareja) */
  organic?: boolean;
  hl?: boolean;
  dim?: boolean;
}
export interface DecorNodeData extends Record<string, unknown> {
  kind: 'trunk' | 'rings';
  w: number;
  h: number;
  /** trunk: tronco y ramas (relativos al nodo) */
  crown?: Crown;
  /** trunk: centros del follaje (uno por tarjeta) y su radio */
  leaves?: { x: number; y: number }[];
  leafR?: number;
  /** rings: radios de cada generación */
  radii?: number[];
}
/** Datos de las líneas: forma de rama y el vínculo que representan (para poder borrarlo con un clic). */
export interface LinkEdgeData extends Record<string, unknown> {
  shape?: 'vertical' | 'radial' | 'straight';
  w1?: number;
  w2?: number;
  dashed?: boolean;
  floating?: boolean;
  pc?: { parentId: string; childId: string }[];
  partnershipId?: string;
  label?: string;
}

export type PersonFlowNode = Node<PersonNodeData, 'person'>;
export type UnionFlowNode = Node<UnionNodeData, 'union'>;
export type DecorFlowNode = Node<DecorNodeData, 'decor'>;
export type FlowNode = PersonFlowNode | UnionFlowNode | DecorFlowNode;
export type LinkEdge = Edge<LinkEdgeData>;

const center = (p: { position: { x: number; y: number } }) => ({
  x: p.position.x + NODE_W / 2,
  y: p.position.y + NODE_H / 2,
});

/** Alto del nodo de unión: va de la línea de pareja al borde de las tarjetas,
 *  así la "barra" que reparte a los hijos queda en el hueco entre generaciones. */
export const UNION_H = NODE_H / 2;

/** Recoloca los nodos de unión en el punto medio de cada pareja (también mientras se arrastra). */
export function placeUnions(nodes: FlowNode[]): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    if (n.type !== 'union') return n;
    const [a, b] = n.data.parents.map((id) => byId.get(id));
    if (!a || !b) return n;
    const ca = center(a);
    const cb = center(b);
    const mx = (ca.x + cb.x) / 2;
    const my = (ca.y + cb.y) / 2;
    const half = n.data.mode === 'radial' ? 1 : n.data.w / 2;
    const x = mx - half;
    const y = n.data.mode === 'tree' ? my - UNION_H : n.data.mode === 'radial' ? my - 1 : my;
    if (n.position.x === x && n.position.y === y) return n;
    return { ...n, position: { x, y } };
  });
}

interface BuildArgs {
  persons: Record<string, Person>;
  families: Family[];
  relations: Map<string, string>;
  gen: Map<string, number>;
  rootId: string | null;
  path: Set<string>;
  focus: boolean;
  mode: LayoutMode;
  edgeStyle: EdgeStyle;
  edgeColor: string;
  accent: string;
}

export function buildFlow(a: BuildArgs) {
  const { persons, families, relations, gen, rootId, path, focus, mode, edgeStyle, edgeColor, accent } = a;
  const hasPath = path.size > 1;
  const organic = mode !== 'generations' || edgeStyle === 'branch';
  const maxGen = Math.max(1, ...gen.values());
  // Ramas más gruesas cerca del tronco (generaciones antiguas), más finas en la copa
  // Baja en pasos iguales por generación y con piso de 6 px: las ramas de la copa siguen viéndose como ramas, no como hilos
  const wOf = (id: string) => (organic ? 6 + 11 * (1 - (gen.get(id) ?? 0) / maxGen) : 2);
  const name = (id: string) => persons[id]?.firstName ?? '';

  const nodes: FlowNode[] = Object.values(persons).map((p) => ({
    id: p.id,
    type: 'person' as const,
    position: { x: p.posX ?? 0, y: p.posY ?? 0 },
    data: {
      person: p,
      relation: relations.get(p.id),
      isRoot: p.id === rootId,
      highlight: hasPath && path.has(p.id),
      dim: focus && hasPath && !path.has(p.id),
    },
    width: NODE_W,
    height: NODE_H,
  }));

  const edges: LinkEdge[] = [];
  const posX = (id: string) => persons[id]?.posX ?? 0;
  const cls = (on: boolean) => (hasPath ? (on ? 'edge-hl' : focus ? 'edge-dim' : '') : '');
  const arrow = (on: boolean) =>
    organic ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14, color: on && hasPath ? accent : edgeColor };
  const childType = organic ? 'branch' : edgeStyle;
  const shape = mode === 'radial' ? 'radial' : 'vertical';
  // Asas: en modo árbol los hijos están ARRIBA, así que las líneas salen por arriba y llegan por abajo
  const up = mode === 'tree';
  const childHandle = up ? 'b' : 't';
  const parentHandle = up ? 't' : 'b';

  for (const f of families) {
    if (f.parents.some((id) => !persons[id])) continue;

    if (f.parents.length === 2) {
      const [pa, pb] = f.parents;
      const uid = `${f.id}:${mode}`; // id distinto por modo: las asas de la unión cambian de lado
      const unionOn = f.children.some((c) => path.has(c.id)) && (path.has(pa) || path.has(pb));
      const uw = organic ? Math.max(wOf(pa), wOf(pb)) * 0.9 : 2;
      nodes.push({
        id: uid,
        type: 'union' as const,
        position: { x: 0, y: 0 },
        data: { parents: f.parents, mode, w: uw, organic, hl: hasPath && unionOn, dim: focus && hasPath && !unionOn },
        draggable: false,
        selectable: false,
        connectable: false,
        width: mode === 'radial' ? 2 : uw,
        height: mode === 'radial' ? 2 : UNION_H,
        zIndex: -1,
      });
      const mid = (posX(pa) + posX(pb)) / 2;
      const ended = f.partnership && ['divorced', 'separated'].includes(f.partnership.kind);
      const coupleOnPath = path.has(pa) && path.has(pb);
      for (const pid of [pa, pb]) {
        const on = coupleOnPath || (path.has(pid) && f.children.some((c) => path.has(c.id)));
        edges.push({
          id: `e:${uid}:${pid}`,
          source: pid,
          sourceHandle: posX(pid) <= mid ? 'r' : 'l',
          target: uid,
          targetHandle: 'in',
          type: organic ? 'branch' : 'straight',
          className: `edge-partner ${cls(on)}`,
          style: ended && !organic ? { strokeDasharray: '7 6' } : undefined,
          data: {
            shape: 'straight',
            // Ramita que se afina hacia cada pareja: con la unión forman una "Y", no una "⊥"
            w1: organic ? Math.max(2.5, uw * 0.4) : 2.5,
            w2: organic ? Math.max(2.5, uw * 0.9) : 2.5,
            dashed: !!ended,
            floating: mode === 'radial',
            partnershipId: f.partnership?.id,
            label: f.partnership ? `Pareja: ${name(pa)} y ${name(pb)}` : undefined,
          },
          selectable: false,
          zIndex: -1,
        });
      }
      for (const c of f.children) {
        const on = path.has(c.id) && (path.has(pa) || path.has(pb));
        edges.push({
          id: `e:${uid}:${c.id}`,
          source: uid,
          sourceHandle: 'out',
          target: c.id,
          targetHandle: childHandle,
          type: childType,
          className: `edge-child ${cls(on)}`,
          style: !organic && c.kind !== 'biological' ? { strokeDasharray: '5 5' } : undefined,
          markerEnd: arrow(on),
          data: {
            shape,
            w1: uw,
            w2: wOf(c.id) * 0.9,
            dashed: c.kind !== 'biological',
            floating: mode === 'radial',
            pc: [{ parentId: pa, childId: c.id }, { parentId: pb, childId: c.id }],
            label: `${name(pa)} y ${name(pb)} → ${name(c.id)}`,
          },
          selectable: false,
          zIndex: -1,
        });
      }
    } else {
      const [p] = f.parents;
      for (const c of f.children) {
        const on = path.has(p) && path.has(c.id);
        edges.push({
          id: `e:${f.id}:${c.id}`,
          source: p,
          sourceHandle: parentHandle,
          target: c.id,
          targetHandle: childHandle,
          type: childType,
          className: `edge-child ${cls(on)}`,
          style: !organic && c.kind !== 'biological' ? { strokeDasharray: '5 5' } : undefined,
          markerEnd: arrow(on),
          data: {
            shape,
            w1: wOf(p) * 0.9,
            w2: wOf(c.id) * 0.9,
            dashed: c.kind !== 'biological',
            floating: mode === 'radial',
            pc: [{ parentId: p, childId: c.id }],
            label: `${name(p)} → ${name(c.id)}`,
          },
          selectable: false,
          zIndex: -1,
        });
      }
    }
  }

  // ---------- Decoración: tronco (modo árbol) o anillos (modo radial) ----------
  const centerOf = (id: string) => ({ x: (persons[id].posX ?? 0) + NODE_W / 2, y: (persons[id].posY ?? 0) + NODE_H / 2 });
  if (mode === 'tree' && Object.keys(persons).length) {
    // Raíces de cada linaje: parejas (o personas) con hijos y sin padres registrados, en la generación que sea.
    // Antes sólo se tomaba la generación más antigua y los demás linajes quedaban "flotando".
    const isChild = new Set(families.flatMap((f) => f.children.map((c) => c.id)));
    const anchors = families
      .filter((f) => f.children.length && f.parents.every((p) => persons[p] && !isChild.has(p)))
      .map((f) => {
        const cs = f.parents.map(centerOf);
        const x = cs.reduce((s, c) => s + c.x, 0) / cs.length;
        // Pareja: la rama llega a la línea que los une; persona sola: al borde inferior de su tarjeta
        const y = f.parents.length === 2 ? cs.reduce((s, c) => s + c.y, 0) / cs.length : cs[0].y + NODE_H / 2 - 4;
        // Borde inferior de las tarjetas: la rama sube recta desde ahí para no cruzar por encima de ellas
        const bottom = Math.max(...cs.map((c) => c.y)) + NODE_H / 2 + 6;
        return { x, y, w: wOf(f.parents[0]), bottom };
      });
    if (!anchors.length) {
      const first = Object.keys(persons)[0];
      const c = centerOf(first);
      anchors.push({ x: c.x, y: c.y + NODE_H / 2 - 4, w: 10, bottom: c.y + NODE_H / 2 + 6 });
    }
    // Ramaje que se bifurca por niveles debajo de la tarjeta más baja (ver crown.ts)
    const centers = Object.keys(persons).map(centerOf);
    const lowest = Math.max(...centers.map((c) => c.y)) + NODE_H / 2;
    const highest = Math.min(...centers.map((c) => c.y)) - NODE_H / 2;
    const cardsH = lowest - highest;
    const spanA = Math.max(...anchors.map((a) => a.x)) - Math.min(...anchors.map((a) => a.x));
    // Proporción de árbol: las tarjetas son la copa; ramaje y tronco, una fracción de su alto
    const crown = growCrown(anchors, {
      floor: lowest + 60,
      depth: Math.min(1100, Math.max(180, cardsH * 0.45, spanA * 0.28)),
      trunk: Math.min(600, Math.max(220, cardsH * 0.3, spanA * 0.14)),
    });
    // Follaje: un círculo detrás de cada tarjeta; juntos forman la silueta de la copa
    const R = NODE_H * 1.3;
    const xs = [crown.trunk.x, ...centers.map((c) => c.x)];
    const minX = Math.min(...xs) - Math.max(260, R + 20);
    const maxX = Math.max(...xs) + Math.max(260, R + 20);
    const top = highest - R + NODE_H / 2 - 10;
    const rel = (p: { x: number; y: number }) => ({ x: p.x - minX, y: p.y - top });
    const h = crown.trunk.baseY - top + 20;
    nodes.push({
      id: 'decor:trunk',
      type: 'decor' as const,
      position: { x: minX, y: top },
      data: {
        kind: 'trunk',
        w: maxX - minX,
        h,
        crown: {
          trunk: { ...crown.trunk, x: crown.trunk.x - minX, forkY: crown.trunk.forkY - top, baseY: crown.trunk.baseY - top },
          limbs: crown.limbs.map((l) => ({ ...l, from: rel(l.from), to: rel(l.to), tip: l.tip && rel(l.tip) })),
        },
        leaves: centers.map(rel),
        leafR: R,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      width: maxX - minX,
      height: h,
      zIndex: -2,
    });
  }
  if (mode === 'radial') {
    const byGen = new Map<number, number[]>();
    for (const id of Object.keys(persons)) {
      const c = centerOf(id);
      const g = gen.get(id) ?? 0;
      if (!byGen.has(g)) byGen.set(g, []);
      byGen.get(g)!.push(Math.hypot(c.x, c.y));
    }
    const radii = [...byGen.values()]
      .map((rs) => rs.reduce((s, r) => s + r, 0) / rs.length)
      .filter((r) => r > NODE_W)
      .sort((x, y) => x - y);
    if (radii.length) {
      const R = radii[radii.length - 1] + NODE_H;
      nodes.push({
        id: 'decor:rings',
        type: 'decor' as const,
        position: { x: -R, y: -R },
        data: { kind: 'rings', w: 2 * R, h: 2 * R, radii },
        draggable: false,
        selectable: false,
        connectable: false,
        width: 2 * R,
        height: 2 * R,
        zIndex: -2,
      });
    }
  }
  return { nodes: placeUnions(nodes), edges };
}
