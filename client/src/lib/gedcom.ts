/**
 * GEDCOM 5.5.1: el formato estándar para intercambiar árboles genealógicos
 * (Ancestry, MyHeritage, FamilySearch, Gramps, etc.).
 */
import type { Snapshot } from '../api';
import type { Gender, ParentChild, ParentKind, Partnership, PartnerKind, Person } from '../types';
import { computeFamilies } from './graph';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---------------------------------------------------------------- Exportar

/** "1950-03-12" → "12 MAR 1950" */
function toGedDate(d: string) {
  const [y, m, day] = d.split('-');
  if (day) return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
  if (m) return `${MONTHS[Number(m) - 1]} ${y}`;
  return y;
}

/** Texto largo → líneas CONT (salto de línea) y CONC (continuación) como pide el estándar. */
function textLines(level: number, tag: string, text: string): string[] {
  const out: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const chunks = line.match(/.{1,200}/g) ?? [''];
    chunks.forEach((chunk, j) => {
      if (i === 0 && j === 0) out.push(`${level} ${tag} ${chunk}`.trimEnd());
      else out.push(`${level + 1} ${j === 0 ? 'CONT' : 'CONC'} ${chunk}`.trimEnd());
    });
  });
  return out;
}

const clean = (s: string) => s.replace(/[\r\n@]/g, ' ').trim();

export function exportGedcom(data: Snapshot, treeName: string, origin = location.origin): string {
  const iid = new Map(data.persons.map((p, i) => [p.id, `@I${i + 1}@`]));
  const families = computeFamilies(data.parentChild, data.partnerships).filter((f) => f.parents.every((p) => iid.has(p)));
  const fid = new Map(families.map((f, i) => [f.id, `@F${i + 1}@`]));
  const PEDI: Partial<Record<ParentKind, string>> = { adoptive: 'adopted', foster: 'foster' };

  const L: string[] = [
    '0 HEAD',
    '1 SOUR RAICES',
    '2 NAME Raíces · Árbol familiar',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
    `1 DATE ${toGedDate(new Date().toISOString().slice(0, 10))}`,
    ...textLines(1, 'NOTE', `Exportado desde Raíces: ${treeName}`),
  ];

  for (const p of data.persons) {
    L.push(`0 ${iid.get(p.id)} INDI`);
    L.push(`1 NAME ${clean(p.firstName)} /${clean(p.lastName ?? '')}/`);
    L.push(`2 GIVN ${clean(p.firstName)}`);
    if (p.lastName) L.push(`2 SURN ${clean(p.lastName)}`);
    L.push(`1 SEX ${p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'U'}`);
    if (p.birthDate || p.birthPlace) {
      L.push('1 BIRT');
      if (p.birthDate) L.push(`2 DATE ${toGedDate(p.birthDate)}`);
      if (p.birthPlace) L.push(`2 PLAC ${clean(p.birthPlace)}`);
    }
    if (p.deathDate) L.push('1 DEAT', `2 DATE ${toGedDate(p.deathDate)}`);
    if (p.notes) L.push(...textLines(1, 'NOTE', p.notes));
    if (p.photoUrl) {
      const url = p.photoUrl.startsWith('http') ? p.photoUrl : origin + p.photoUrl;
      L.push('1 OBJE', `2 FILE ${url}`, '3 FORM webp');
    }
    for (const f of families) {
      const child = f.children.find((c) => c.id === p.id);
      if (child) {
        L.push(`1 FAMC ${fid.get(f.id)}`);
        if (PEDI[child.kind]) L.push(`2 PEDI ${PEDI[child.kind]}`);
      }
      if (f.parents.includes(p.id)) L.push(`1 FAMS ${fid.get(f.id)}`);
    }
  }

  const byId = new Map(data.persons.map((p) => [p.id, p]));
  for (const f of families) {
    L.push(`0 ${fid.get(f.id)} FAM`);
    // HUSB/WIFE: el estándar 5.5.1 los distingue; con el mismo género o desconocido se usa el orden
    const ps = [...f.parents].sort((a, b) => (byId.get(a)!.gender === 'female' ? 1 : 0) - (byId.get(b)!.gender === 'female' ? 1 : 0));
    if (ps[0]) L.push(`1 HUSB ${iid.get(ps[0])}`);
    if (ps[1]) L.push(`1 WIFE ${iid.get(ps[1])}`);
    const kind = f.partnership?.kind;
    if (kind && kind !== 'partner') L.push('1 MARR');
    if (kind === 'divorced') L.push('1 DIV');
    if (kind === 'separated') L.push('1 EVEN', '2 TYPE Separación');
    for (const c of f.children) L.push(`1 CHIL ${iid.get(c.id)}`);
  }
  L.push('0 TRLR');
  return L.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- Importar

interface Node {
  tag: string;
  xref?: string;
  value: string;
  children: Node[];
}

function parseTree(text: string): Node[] {
  const root: Node = { tag: 'ROOT', value: '', children: [] };
  const stack: { level: number; node: Node }[] = [{ level: -1, node: root }];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const m = /^\s*(\d+)\s+(@[^@]+@\s+)?(\S+)(?: (.*))?$/.exec(raw);
    if (!m) continue;
    const level = Number(m[1]);
    const node: Node = { tag: m[3].toUpperCase(), xref: m[2]?.trim(), value: m[4] ?? '', children: [] };
    if (node.tag === 'CONC' || node.tag === 'CONT') {
      const parent = stack[stack.length - 1].node;
      parent.value += (node.tag === 'CONT' ? '\n' : '') + node.value;
      continue;
    }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level, node });
  }
  return root.children;
}

const child = (n: Node | undefined, tag: string) => n?.children.find((c) => c.tag === tag);
const children = (n: Node, tag: string) => n.children.filter((c) => c.tag === tag);

/** "ABT 12 MAR 1950" → { date: "1950-03-12", approx: true } */
function fromGedDate(v: string | undefined): { date: string | null; approx: boolean; raw: string } {
  const raw = (v ?? '').trim();
  if (!raw) return { date: null, approx: false, raw };
  const approx = /\b(ABT|EST|CAL|BEF|AFT|BET|FROM|TO|INT)\b/i.test(raw) || /[()]/.test(raw);
  const m = /(?:(\d{1,2})\s+)?(?:(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?(\d{3,4})/i.exec(raw);
  if (!m) return { date: null, approx: true, raw };
  const y = m[3].padStart(4, '0');
  if (!m[2]) return { date: y, approx, raw };
  const mo = String(MONTHS.indexOf(m[2].toUpperCase()) + 1).padStart(2, '0');
  if (!m[1]) return { date: `${y}-${mo}`, approx, raw };
  return { date: `${y}-${mo}-${m[1].padStart(2, '0')}`, approx, raw };
}

const cut = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);

export interface ImportResult extends Snapshot {
  name: string;
  rootPersonId: string | null;
  warnings: string[];
}

/** Lee un archivo .ged (UTF-8 o Windows-1252) y lo convierte en personas y vínculos listos para guardar. */
export function parseGedcom(buffer: ArrayBuffer, fileName: string): ImportResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer); // archivos antiguos
  }
  text = text.replace(/^﻿/, '');
  const records = parseTree(text);
  const warnings: string[] = [];
  const noteRecords = new Map(records.filter((r) => r.tag === 'NOTE' && r.xref).map((r) => [r.xref!, r.value]));

  // ---- Personas
  const idOf = new Map<string, string>();
  const persons: Person[] = [];
  for (const r of records.filter((x) => x.tag === 'INDI' && x.xref)) {
    const id = crypto.randomUUID();
    idOf.set(r.xref!, id);
    const nameNode = child(r, 'NAME');
    const nameVal = nameNode?.value ?? '';
    const surname = child(nameNode, 'SURN')?.value ?? /\/([^/]*)\//.exec(nameVal)?.[1] ?? '';
    const given = child(nameNode, 'GIVN')?.value ?? nameVal.replace(/\/[^/]*\//, '').trim();
    const sex = child(r, 'SEX')?.value.trim().toUpperCase();
    const gender: Gender = sex === 'M' ? 'male' : sex === 'F' ? 'female' : 'unknown';

    const birthEv = child(r, 'BIRT') ?? child(r, 'CHR') ?? child(r, 'BAPM');
    const deathEv = child(r, 'DEAT') ?? child(r, 'BURI');
    const birth = fromGedDate(child(birthEv, 'DATE')?.value);
    let death = fromGedDate(child(deathEv, 'DATE')?.value);
    const notes: string[] = [];
    if (birth.approx && birth.raw) notes.push(`Nacimiento (fecha original): ${birth.raw}`);
    if (death.approx && death.raw) notes.push(`Fallecimiento (fecha original): ${death.raw}`);
    const deathPlace = child(deathEv, 'PLAC')?.value;
    if (deathPlace) notes.push(`Lugar de fallecimiento: ${deathPlace}`);
    if (birth.date && death.date && death.date < birth.date) {
      notes.push(`Fecha de fallecimiento descartada por ser anterior al nacimiento: ${death.raw}`);
      death = { date: null, approx: false, raw: '' };
    }
    for (const n of children(r, 'NOTE')) notes.push(noteRecords.get(n.value.trim()) ?? n.value);
    const file = children(r, 'OBJE').map((o) => child(o, 'FILE')?.value ?? '').find((f) => /^https:\/\//.test(f));

    persons.push({
      id,
      treeId: '',
      firstName: cut(given, 120) ?? '(sin nombre)',
      lastName: cut(surname, 120),
      gender,
      birthDate: birth.date,
      deathDate: death.date,
      birthPlace: cut(child(birthEv, 'PLAC')?.value, 200),
      notes: cut(notes.join('\n\n'), 5000),
      photoUrl: file ?? null,
      color: null,
      posX: null,
      posY: null,
    });
  }

  // Tipo de filiación declarado en el hijo (FAMC + PEDI)
  const pedi = new Map<string, ParentKind>(); // `${famXref}|${childXref}` → tipo
  for (const r of records.filter((x) => x.tag === 'INDI' && x.xref)) {
    for (const famc of children(r, 'FAMC')) {
      const v = child(famc, 'PEDI')?.value.trim().toLowerCase();
      const kind: ParentKind = v === 'adopted' ? 'adoptive' : v === 'foster' ? 'foster' : v === 'step' ? 'step' : 'biological';
      pedi.set(`${famc.value.trim()}|${r.xref}`, kind);
    }
  }

  // ---- Familias → parejas y padre/hijo, respetando las reglas de la base de datos
  const parentChild: ParentChild[] = [];
  const partnerships: Partnership[] = [];
  const pairs = new Set<string>();
  const parentsOf = new Map<string, string[]>();
  const isAncestor = (anc: string, of: string) => {
    const seen = new Set<string>();
    const queue = [of];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of parentsOf.get(cur) ?? []) {
        if (p === anc) return true;
        if (!seen.has(p)) seen.add(p), queue.push(p);
      }
    }
    return false;
  };

  for (const f of records.filter((x) => x.tag === 'FAM')) {
    const parents = [child(f, 'HUSB'), child(f, 'WIFE')].map((n) => idOf.get(n?.value.trim() ?? '')).filter(Boolean) as string[];
    if (parents.length === 2) {
      const key = [...parents].sort().join('|');
      if (!pairs.has(key) && parents[0] !== parents[1]) {
        pairs.add(key);
        const kind: PartnerKind = child(f, 'DIV') ? 'divorced' : child(f, 'MARR') ? 'married' : 'partner';
        partnerships.push({ id: crypto.randomUUID(), personA: parents[0], personB: parents[1], kind });
      }
    }
    for (const c of children(f, 'CHIL')) {
      const cid = idOf.get(c.value.trim());
      if (!cid) continue;
      for (const pid of parents) {
        if (pid === cid || parentChild.some((r) => r.parentId === pid && r.childId === cid)) continue;
        if (isAncestor(cid, pid)) {
          warnings.push('Se omitió una relación que creaba un ciclo (alguien como su propio ancestro).');
          continue;
        }
        let kind = pedi.get(`${f.xref}|${c.value.trim()}`) ?? 'biological';
        const bio = parentChild.filter((r) => r.childId === cid && r.kind === 'biological').length;
        if (kind === 'biological' && bio >= 2) {
          kind = 'adoptive'; // la base admite máximo dos padres biológicos
          warnings.push('Una persona tenía más de dos padres biológicos; los extra se marcaron como adoptivos.');
        }
        parentChild.push({ parentId: pid, childId: cid, kind });
        parentsOf.set(cid, [...(parentsOf.get(cid) ?? []), pid]);
      }
    }
  }
  // Una pareja no puede ser también padre/hijo
  const pcSet = new Set(parentChild.flatMap((r) => [`${r.parentId}|${r.childId}`, `${r.childId}|${r.parentId}`]));
  const validPartners = partnerships.filter((p) => !pcSet.has(`${p.personA}|${p.personB}`));

  // Nombre sugerido: el apellido más frecuente, o el nombre del archivo
  const counts = new Map<string, number>();
  for (const p of persons) if (p.lastName) counts.set(p.lastName.split(' ')[0], (counts.get(p.lastName.split(' ')[0]) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const name = top ? `Familia ${top}` : fileName.replace(/\.ged$/i, '') || 'Árbol importado';

  return {
    name: name.slice(0, 120),
    rootPersonId: persons[0]?.id ?? null,
    persons,
    parentChild,
    partnerships: validPartners,
    warnings: [...new Set(warnings)],
  };
}
