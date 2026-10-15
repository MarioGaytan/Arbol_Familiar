import { describe, expect, it } from 'vitest';
import { age, DATE_RE, formatDate, g, initials, lifespan, longDate } from './format';
import { family } from '../test/family';

describe('fechas parciales (año, mes o día)', () => {
  it('acepta AAAA, AAAA-MM y AAAA-MM-DD, y nada más', () => {
    for (const ok of ['1950', '1950-03', '1950-03-12']) expect(DATE_RE.test(ok)).toBe(true);
    for (const bad of ['50', '1950-13', '1950-02-32', '1950/03/12', '']) expect(DATE_RE.test(bad)).toBe(false);
  });

  it('formatea respetando la precisión', () => {
    expect(formatDate('1950')).toBe('1950');
    expect(formatDate('1950-03')).toBe('mar 1950');
    expect(formatDate('1950-03-02')).toBe('2 mar 1950');
    expect(longDate('1978-04-12')).toBe('12 de abril de 1978');
    expect(longDate('1978-04')).toBe('abril de 1978');
  });
});

describe('edad', () => {
  const hoy = new Date(2026, 9, 7); // 7 oct 2026

  it('cuenta si ya pasó el cumpleaños este año', () => {
    expect(age({ birthDate: '1984-08-15', deathDate: null }, hoy)).toBe(42);
    expect(age({ birthDate: '1984-12-15', deathDate: null }, hoy)).toBe(41);
  });

  it('con sólo el año, calcula por año', () => {
    expect(age({ birthDate: '1984', deathDate: null }, hoy)).toBe(42);
  });

  it('para quien falleció, la edad al morir', () => {
    expect(age({ birthDate: '1928-03-14', deathDate: '2004-11-02' }, hoy)).toBe(76);
  });

  it('sin nacimiento o con datos imposibles no inventa una edad', () => {
    expect(age({ birthDate: null, deathDate: null }, hoy)).toBeNull();
    expect(age({ birthDate: '1700', deathDate: null }, hoy)).toBeNull();
  });
});

describe('textos de la tarjeta', () => {
  const { persons } = family();

  it('línea de vida', () => {
    expect(lifespan(persons.abuelo)).toBe('1930 – 2000');
    expect(lifespan(persons.yo)).toBe('n. 1984');
    expect(lifespan({ ...persons.yo, birthDate: null })).toBe('');
  });

  it('iniciales', () => {
    expect(initials({ firstName: 'ana maría', lastName: 'Ruiz' })).toBe('AR');
    expect(initials({ firstName: '', lastName: null })).toBe('?');
  });

  it('palabras con género, y ambas formas si no se conoce', () => {
    expect(g('male', 'Tío abuelo', 'Tía abuela')).toBe('Tío abuelo');
    expect(g('female', 'Tío abuelo', 'Tía abuela')).toBe('Tía abuela');
    expect(g('unknown', 'Tío abuelo', 'Tía abuela')).toBe('Tío/a abuelo/a');
  });
});
