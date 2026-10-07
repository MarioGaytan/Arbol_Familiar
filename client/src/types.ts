export type Gender = 'male' | 'female' | 'other' | 'unknown';
export type ParentKind = 'biological' | 'adoptive' | 'step' | 'foster';
export type PartnerKind = 'married' | 'partner' | 'divorced' | 'separated' | 'widowed';

export interface Person {
  id: string;
  treeId: string;
  firstName: string;
  lastName: string | null;
  gender: Gender;
  /** "AAAA" | "AAAA-MM" | "AAAA-MM-DD" */
  birthDate: string | null;
  deathDate: string | null;
  birthPlace: string | null;
  notes: string | null;
  photoUrl: string | null;
  color: string | null;
  posX: number | null;
  posY: number | null;
}

export interface ParentChild {
  parentId: string;
  childId: string;
  kind: ParentKind;
}

export interface Partnership {
  id: string;
  personA: string;
  personB: string;
  kind: PartnerKind;
}

export type PhotoShape = 'circle' | 'rounded' | 'square';
export type EdgeStyle = 'smoothstep' | 'default' | 'step' | 'straight' | 'branch';
export type Pattern = 'dots' | 'lines' | 'cross' | 'none';
/** generations: de arriba hacia abajo · tree: crece hacia arriba desde un tronco · radial: anillos */
export type LayoutMode = 'generations' | 'tree' | 'radial';

export interface TreeSettings {
  preset?: string;
  /** Diseño propio del que se partió (sólo informativo) */
  userThemeId?: string;
  layoutMode?: LayoutMode;
  /** Reordenar solo al agregar o quitar personas/vínculos (por defecto sí) */
  autoArrange?: boolean;
  accent?: string;
  edgeColor?: string;
  background?: string;
  patternColor?: string;
  cardBg?: string;
  cardBorder?: string;
  text?: string;
  muted?: string;
  maleTint?: string;
  femaleTint?: string;
  font?: string;
  nameFont?: string;
  titleFont?: string;
  radius?: number;
  photoShape?: PhotoShape;
  edgeStyle?: EdgeStyle;
  pattern?: Pattern;
  showDates?: boolean;
  showRelations?: boolean;
}

export type Role = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
}

export interface AdminUser extends User {
  isAdmin: boolean;
  status: 'active' | 'blocked';
  createdAt: string;
  lastLoginAt: string | null;
  ownedTrees: number;
  sharedTrees: number;
  invitedBy: string | null;
}

export interface RegistrationInvite {
  id: string;
  email: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  usedBy: string | null;
  status: 'pending' | 'used' | 'expired' | 'revoked';
}

export interface AdminStats {
  users: number;
  blocked: number;
  trees: number;
  persons: number;
  photos: number;
  photoBytes: number;
  pendingInvites: number;
}

/** Diseño guardado por el usuario: un conjunto de ajustes que se copia al árbol al aplicarlo */
export interface UserTheme {
  id: string;
  name: string;
  theme: TreeSettings;
  updatedAt: string;
}

export interface SharingInfo {
  members: { userId: string; name: string; email: string; role: 'owner' | 'editor' }[];
  invites: { email: string; role: 'editor' }[];
  publicToken: string | null;
  /** Ocultar fotos, fechas y lugares de personas vivas en el enlace público */
  publicHideLiving: boolean;
}

export interface Tree {
  id: string;
  /** Permiso del usuario actual: viewer = enlace público de sólo lectura */
  role?: Role;
  ownerName?: string;
  name: string;
  rootPersonId: string | null;
  theme: TreeSettings;
  updatedAt?: string;
  personCount?: number;
  rootPhoto?: string | null;
}

export interface TreeData {
  tree: Tree;
  persons: Person[];
  parentChild: ParentChild[];
  partnerships: Partnership[];
}

export type RelativeKind = 'parent' | 'child' | 'partner' | 'sibling';
