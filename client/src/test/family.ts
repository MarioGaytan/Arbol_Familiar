import type { Gender, ParentChild, ParentKind, Partnership, PartnerKind, Person } from '../types';

/** Familia inventada para las pruebas: se construye con nombres cortos en lugar de UUID. */
export function family() {
  const persons: Record<string, Person> = {};
  const parentChild: ParentChild[] = [];
  const partnerships: Partnership[] = [];

  const add = (id: string, gender: Gender, birthDate: string | null = null, deathDate: string | null = null) => {
    persons[id] = {
      id, treeId: 't', firstName: id, lastName: 'Prueba', gender, birthDate, deathDate,
      birthPlace: null, notes: null, photoUrl: null, color: null, posX: null, posY: null,
    };
  };
  const child = (parents: string[], id: string, kind: ParentKind = 'biological') =>
    parents.forEach((p) => parentChild.push({ parentId: p, childId: id, kind }));
  const couple = (a: string, b: string, kind: PartnerKind = 'married') =>
    partnerships.push({ id: `${a}+${b}`, personA: a, personB: b, kind });

  //            abuelo + abuela
  //          ┌───────┴────────┐
  //   papá + mamá          tío + tía          suegro + suegra
  //   ┌────┼──────┐           │                     │
  //  yo  hermana  medio*     primo               esposa
  //  │      │                 │
  // hijo  sobrino        primo2 (hijo de primo)
  // *medio hermano: hijo de papá con otra pareja (exesposa)
  add('abuelo', 'male', '1930', '2000'); add('abuela', 'female', '1932');
  add('papa', 'male', '1955'); add('mama', 'female', '1958'); add('exesposa', 'female', '1957');
  add('tio', 'male', '1960'); add('tia', 'female', '1962');
  add('yo', 'female', '1984-08-15'); add('hermana', 'female', '1987'); add('medio', 'male', '1980');
  add('primo', 'male', '1990'); add('primo2', 'unknown', '2015');
  add('hijo', 'male', '2012'); add('sobrino', 'male', '2018');
  add('suegro', 'male', '1950'); add('suegra', 'female', '1952'); add('esposa', 'female', '1983');
  add('cunado', 'male', '1986'); add('padrastro', 'male', '1956');

  couple('abuelo', 'abuela', 'widowed');
  child(['abuelo', 'abuela'], 'papa');
  child(['abuelo', 'abuela'], 'tio');
  couple('papa', 'mama');
  couple('papa', 'exesposa', 'divorced');
  couple('tio', 'tia');
  child(['papa', 'mama'], 'yo');
  child(['papa', 'mama'], 'hermana');
  child(['papa', 'exesposa'], 'medio');
  child(['tio', 'tia'], 'primo');
  child(['primo'], 'primo2');
  child(['yo'], 'hijo');
  child(['hermana'], 'sobrino');
  couple('hermana', 'cunado', 'separated');
  child(['suegro', 'suegra'], 'esposa');
  couple('yo', 'esposa');
  child(['padrastro'], 'yo', 'step');

  return { persons, parentChild, partnerships };
}
