import type { ParentChild, ParentKind, Partnership, PartnerKind, Person, SharingInfo, Tree, TreeData, User } from './types';

/** Identifica esta pestaña: el servidor no le reenvía sus propios cambios. */
export const CLIENT_ID = crypto.randomUUID();

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: { 'X-Client-Id': CLIENT_ID, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  // Sesión vencida o cerrada en otro lado: la app vuelve a la pantalla de acceso
  if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('auth:expired'));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

export type PersonInput = Partial<Omit<Person, 'id' | 'treeId'>>;

/** Conjunto de personas y vínculos que se puede reinsertar tal cual (para deshacer/rehacer). */
export interface Snapshot {
  persons: Person[];
  parentChild: ParentChild[];
  partnerships: Partnership[];
}

export const api = {
  me: () => req<{ user: User }>('GET', '/api/auth/me'),
  register: (name: string, email: string, password: string) =>
    req<{ user: User }>('POST', '/api/auth/register', { name, email, password }),
  login: (email: string, password: string) => req<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => req('POST', '/api/auth/logout'),

  getSharing: (treeId: string) => req<SharingInfo>('GET', `/api/trees/${treeId}/sharing`),
  addMember: (treeId: string, email: string) => req<SharingInfo>('POST', `/api/trees/${treeId}/members`, { email }),
  removeMember: (treeId: string, userId: string) => req<SharingInfo>('DELETE', `/api/trees/${treeId}/members/${userId}`),
  removeInvite: (treeId: string, email: string) =>
    req<SharingInfo>('DELETE', `/api/trees/${treeId}/invites?email=${encodeURIComponent(email)}`),
  setPublicLink: (treeId: string, enabled: boolean) =>
    req<SharingInfo>('POST', `/api/trees/${treeId}/public-link`, { enabled }),
  getPublicTree: (token: string) => req<TreeData>('GET', `/api/public/${encodeURIComponent(token)}`),

  listTrees: () => req<Tree[]>('GET', '/api/trees'),
  createTree: (name: string, rootPerson?: PersonInput) => req<Tree>('POST', '/api/trees', { name, rootPerson }),
  getTree: (id: string) => req<TreeData>('GET', `/api/trees/${id}`),
  updateTree: (id: string, patch: Partial<Pick<Tree, 'name' | 'rootPersonId' | 'theme'>>) =>
    req<Tree>('PATCH', `/api/trees/${id}`, patch),
  deleteTree: (id: string) => req('DELETE', `/api/trees/${id}`),

  createPerson: (
    treeId: string,
    body: { person: PersonInput; parents?: { id: string; kind?: ParentKind }[]; children?: string[]; partners?: string[] },
  ) => req<{ person: Person; parentChild: ParentChild[]; partnerships: Partnership[] }>('POST', `/api/trees/${treeId}/persons`, body),
  updatePerson: (treeId: string, id: string, patch: PersonInput) =>
    req<Person>('PATCH', `/api/trees/${treeId}/persons/${id}`, patch),
  deletePerson: (treeId: string, id: string) => req('DELETE', `/api/trees/${treeId}/persons/${id}`),
  savePositions: (treeId: string, items: { id: string; x: number; y: number }[]) =>
    req('PUT', `/api/trees/${treeId}/positions`, items),

  linkParent: (treeId: string, parentId: string, childId: string, kind?: ParentKind) =>
    req<ParentChild>('POST', `/api/trees/${treeId}/parent-child`, { parentId, childId, kind }),
  updateParentKind: (treeId: string, parentId: string, childId: string, kind: ParentKind) =>
    req<ParentChild>('PATCH', `/api/trees/${treeId}/parent-child`, { parentId, childId, kind }),
  unlinkParent: (treeId: string, parentId: string, childId: string) =>
    req('DELETE', `/api/trees/${treeId}/parent-child?parentId=${parentId}&childId=${childId}`),

  addPartnership: (treeId: string, personA: string, personB: string, kind?: PartnerKind) =>
    req<Partnership>('POST', `/api/trees/${treeId}/partnerships`, { personA, personB, kind }),
  updatePartnership: (treeId: string, id: string, kind: PartnerKind) =>
    req<Partnership>('PATCH', `/api/trees/${treeId}/partnerships/${id}`, { kind }),
  deletePartnership: (treeId: string, id: string) => req('DELETE', `/api/trees/${treeId}/partnerships/${id}`),

  importTree: (body: Snapshot & { name: string; rootPersonId: string | null }) =>
    req<{ id: string; persons: number }>('POST', '/api/trees/import', body),
  restore: (treeId: string, snap: Snapshot) => req<Snapshot>('POST', `/api/trees/${treeId}/restore`, snap),
  deletePersons: (treeId: string, ids: string[]) => req('POST', `/api/trees/${treeId}/persons/delete`, { ids }),

  uploadPhoto: (blob: Blob) => {
    const fd = new FormData();
    fd.append('file', blob, 'foto.webp');
    return req<{ url: string }>('POST', '/api/uploads', fd);
  },
};
