import type { Gender, Person } from '../types';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const DATE_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

export function formatDate(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  if (day) return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
  if (m) return `${MONTHS[Number(m) - 1]} ${y}`;
  return y;
}

/** Línea corta para la tarjeta: "1932 – 2010", "n. 1985" */
export function lifespan(p: Person): string {
  const b = p.birthDate?.slice(0, 4);
  const d = p.deathDate?.slice(0, 4);
  if (b && d) return `${b} – ${d}`;
  if (d) return `† ${d}`;
  if (b) return `n. ${b}`;
  return '';
}

export const fullName = (p: Pick<Person, 'firstName' | 'lastName'>) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ');

export function initials(p: Pick<Person, 'firstName' | 'lastName'>) {
  return ((p.firstName?.[0] ?? '') + (p.lastName?.[0] ?? '')).toUpperCase() || '?';
}

/** Palabra con género: g('Tío abuelo','Tía abuela') → "Tío/a abuelo/a" si el género no se conoce. */
export function g(gender: Gender, masc: string, fem: string): string {
  if (gender === 'male') return masc;
  if (gender === 'female') return fem;
  const mw = masc.split(' ');
  const fw = fem.split(' ');
  if (mw.length !== fw.length) return `${masc}/${fem}`;
  return mw
    .map((m, i) => {
      const f = fw[i];
      if (m === f) return m;
      if (m.slice(0, -1) === f.slice(0, -1)) return `${m}/${f.slice(-1)}`;
      return `${m}/${f}`;
    })
    .join(' ');
}

export const GENDER_LABEL: Record<Gender, string> = {
  male: 'Hombre',
  female: 'Mujer',
  other: 'Otro',
  unknown: '—',
};
