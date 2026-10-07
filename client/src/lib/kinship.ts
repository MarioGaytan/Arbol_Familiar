import type { Gender, ParentChild, Partnership, Person } from '../types';
import { g } from './format';

/** Índices de adyacencia para consultar el grafo familiar rápido. */
export interface FamilyIndex {
  parents: Map<string, ParentChild[]>;
  children: Map<string, ParentChild[]>;
  partners: Map<string, { id: string; kind: Partnership['kind']; partnershipId: string }[]>;
}

export function buildIndex(parentChild: ParentChild[], partnerships: Partnership[]): FamilyIndex {
  const parents = new Map<string, ParentChild[]>();
  const children = new Map<string, ParentChild[]>();
  const partners = new Map<string, { id: string; kind: Partnership['kind']; partnershipId: string }[]>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  for (const r of parentChild) {
    push(parents, r.childId, r);
    push(children, r.parentId, r);
  }
  for (const p of partnerships) {
    push(partners, p.personA, { id: p.personB, kind: p.kind, partnershipId: p.id });
    push(partners, p.personB, { id: p.personA, kind: p.kind, partnershipId: p.id });
  }
  return { parents, children, partners };
}

/** Ancestros con su distancia en generaciones (la persona misma con 0). */
function ancestors(id: string, idx: FamilyIndex): Map<string, number> {
  const depth = new Map([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const r of idx.parents.get(cur) ?? []) {
      if (!depth.has(r.parentId)) {
        depth.set(r.parentId, depth.get(cur)! + 1);
        queue.push(r.parentId);
      }
    }
  }
  return depth;
}

const ORD_M = ['', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto'];
const ORD_F = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta'];
const ord = (gender: Gender, n: number) => (n < ORD_M.length ? g(gender, ORD_M[n], ORD_F[n]) : `${n}°`);

/**
 * Nombre del parentesco por consanguinidad.
 * up = generaciones de la persona central al ancestro común; down = del ancestro común a la persona.
 */
export function bloodLabel(up: number, down: number, gender: Gender, half = false): string {
  if (down === 0) {
    const names: [string, string][] = [
      ['', ''],
      ['Padre', 'Madre'],
      ['Abuelo', 'Abuela'],
      ['Bisabuelo', 'Bisabuela'],
      ['Tatarabuelo', 'Tatarabuela'],
      ['Trastatarabuelo', 'Trastatarabuela'],
    ];
    return up < names.length ? g(gender, ...names[up]) : `${g(gender, 'Ancestro', 'Ancestra')} (${up} gen.)`;
  }
  if (up === 0) {
    const names: [string, string][] = [
      ['', ''],
      ['Hijo', 'Hija'],
      ['Nieto', 'Nieta'],
      ['Bisnieto', 'Bisnieta'],
      ['Tataranieto', 'Tataranieta'],
      ['Trastataranieto', 'Trastataranieta'],
    ];
    return down < names.length ? g(gender, ...names[down]) : `${g(gender, 'Descendiente', 'Descendiente')} (${down} gen.)`;
  }
  if (up === 1 && down === 1) return half ? g(gender, 'Medio hermano', 'Media hermana') : g(gender, 'Hermano', 'Hermana');
  if (down === 1) {
    const extra = ['', '', '', ' abuelo', ' bisabuelo', ' tatarabuelo'];
    const extraF = ['', '', '', ' abuela', ' bisabuela', ' tatarabuela'];
    return up < extra.length ? g(gender, `Tío${extra[up]}`, `Tía${extraF[up]}`) : `${g(gender, 'Tío', 'Tía')} (${up - 1} gen.)`;
  }
  if (up === 1) {
    const extra = ['', '', '', ' nieto', ' bisnieto', ' tataranieto'];
    const extraF = ['', '', '', ' nieta', ' bisnieta', ' tataranieta'];
    return down < extra.length
      ? g(gender, `Sobrino${extra[down]}`, `Sobrina${extraF[down]}`)
      : `${g(gender, 'Sobrino', 'Sobrina')} (${down - 1} gen.)`;
  }
  if (up === down) return up === 2 ? g(gender, 'Primo', 'Prima') : `${g(gender, 'Primo', 'Prima')} ${ord(gender, up - 1)}`;
  if (down === up + 1) return `${g(gender, 'Sobrino', 'Sobrina')} ${ord(gender, up)}`; // hijo de primo = sobrino segundo
  if (up === down + 1) return `${g(gender, 'Tío', 'Tía')} ${ord(gender, down)}`; // primo del padre = tío segundo
  return `Pariente de ${up + down}° grado`;
}

const PARTNER_LABEL: Record<Partnership['kind'], [string, string]> = {
  married: ['Esposo', 'Esposa'],
  partner: ['Pareja', 'Pareja'],
  divorced: ['Ex esposo', 'Ex esposa'],
  separated: ['Ex pareja', 'Ex pareja'],
  widowed: ['Esposo', 'Esposa'],
};

/**
 * Calcula el parentesco de cada persona respecto a la persona central.
 * Nada de esto se guarda en la base de datos: se deriva de padre→hijo y parejas.
 */
export function computeRelations(rootId: string | null, persons: Record<string, Person>, idx: FamilyIndex) {
  const result = new Map<string, string>();
  if (!rootId || !persons[rootId]) return result;

  const rootAnc = ancestors(rootId, idx);
  const blood = new Map<string, { up: number; down: number }>();
  const parentIds = (id: string) => (idx.parents.get(id) ?? []).map((r) => r.parentId);
  const rootParents = new Set(parentIds(rootId));

  for (const id of Object.keys(persons)) {
    const tAnc = ancestors(id, idx);
    let best: { up: number; down: number } | null = null;
    for (const [a, down] of tAnc) {
      const up = rootAnc.get(a);
      if (up === undefined) continue;
      if (!best || up + down < best.up + best.down) best = { up, down };
    }
    if (best) blood.set(id, best);
  }

  const partnersOf = (id: string) => idx.partners.get(id) ?? [];
  const rootPartners = partnersOf(rootId);

  for (const [id, person] of Object.entries(persons)) {
    const gender = person.gender;
    if (id === rootId) {
      result.set(id, 'Persona central');
      continue;
    }
    const b = blood.get(id);
    if (b) {
      let label: string;
      if (b.up === 1 && b.down === 0) {
        const kind = (idx.parents.get(rootId) ?? []).find((r) => r.parentId === id)?.kind;
        label = bloodLabel(1, 0, gender);
        if (kind === 'adoptive') label += g(gender, ' adoptivo', ' adoptiva');
        if (kind === 'step') label = g(gender, 'Padrastro', 'Madrastra');
        if (kind === 'foster') label += ' de acogida';
      } else if (b.up === 1 && b.down === 1) {
        const shared = parentIds(id).filter((p) => rootParents.has(p)).length;
        const half = shared === 1 && (rootParents.size > 1 || parentIds(id).length > 1);
        label = bloodLabel(1, 1, gender, half);
      } else {
        label = bloodLabel(b.up, b.down, gender);
      }
      result.set(id, label);
      continue;
    }

    // ----- Parentescos políticos / por alianza -----
    const direct = rootPartners.find((p) => p.id === id);
    if (direct) {
      result.set(id, g(gender, ...PARTNER_LABEL[direct.kind]));
      continue;
    }
    const myPartners = partnersOf(id);
    let label = '';

    // Pareja de un familiar de sangre
    for (const mp of myPartners) {
      const rb = blood.get(mp.id);
      if (!rb) continue;
      if (rb.up === 1 && rb.down === 0) label = g(gender, 'Padrastro', 'Madrastra');
      else if (rb.up === 0 && rb.down === 1) label = g(gender, 'Yerno', 'Nuera');
      else if (rb.up === 1 && rb.down === 1) label = g(gender, 'Cuñado', 'Cuñada');
      else if (rb.up === 0 && rb.down === 0) continue;
      else label = `${bloodLabel(rb.up, rb.down, gender)} ${g(gender, 'político', 'política')}`;
      break;
    }
    // Familiar de sangre de mi pareja
    if (!label) {
      for (const rp of rootPartners) {
        const pAnc = ancestors(rp.id, idx);
        const tAnc = ancestors(id, idx);
        let best: { up: number; down: number } | null = null;
        for (const [a, down] of tAnc) {
          const up = pAnc.get(a);
          if (up !== undefined && (!best || up + down < best.up + best.down)) best = { up, down };
        }
        if (!best) continue;
        if (best.up === 0 && best.down === 1) label = g(gender, 'Hijastro', 'Hijastra');
        else if (best.up === 1 && best.down === 0) label = g(gender, 'Suegro', 'Suegra');
        else if (best.up === 1 && best.down === 1) label = g(gender, 'Cuñado', 'Cuñada');
        else label = `${bloodLabel(best.up, best.down, gender)} ${g(gender, 'político', 'política')}`;
        break;
      }
    }
    if (label) result.set(id, label);
  }
  return result;
}

/** Camino más corto (por cualquier vínculo) entre dos personas, para resaltar el rastro en el lienzo. */
export function findPath(from: string, to: string, idx: FamilyIndex): string[] {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    const next = [
      ...(idx.parents.get(cur) ?? []).map((r) => r.parentId),
      ...(idx.children.get(cur) ?? []).map((r) => r.childId),
      ...(idx.partners.get(cur) ?? []).map((p) => p.id),
    ];
    for (const n of next) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let c = to;
        while (c !== from) path.push((c = prev.get(c)!));
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return [];
}
