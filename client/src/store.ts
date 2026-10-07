import { create } from 'zustand';
import { api, type PersonInput, type Snapshot } from './api';
import { layoutFor, relativeSpot } from './lib/layout';
import { fullName } from './lib/format';
import type {
  LayoutMode, ParentChild, ParentKind, Partnership, PartnerKind, Person, RelativeKind, Tree, TreeData, TreeSettings, User,
} from './types';

type Toast = { id: number; msg: string; kind: 'error' | 'info'; action?: { label: string; run: () => void } };

/** Una acción deshacible: sabe ir hacia atrás y hacia adelante contra el servidor. */
interface Command {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /** Cambios rápidos repetidos (p. ej. arrastrar un selector de color) se funden en un solo paso */
  mergeKey?: string;
  /** Cambia la estructura (personas o vínculos): al hacerlo/deshacerlo se reordena el árbol */
  structural?: boolean;
  at: number;
}

/** Vínculo seleccionado al hacer clic en una línea del lienzo */
export interface EdgeSelection {
  edgeId?: string;
  pc: { parentId: string; childId: string }[];
  partnershipId?: string;
  label: string;
}

interface EditorState {
  /** Usuario con sesión (null = no ha iniciado sesión) */
  user: User | null;
  /** Vista por enlace público: no se puede editar nada */
  readOnly: boolean;
  tree: Tree | null;
  persons: Record<string, Person>;
  parentChild: ParentChild[];
  partnerships: Partnership[];
  loading: boolean;

  past: Command[];
  future: Command[];
  /** Otras personas con este árbol abierto ahora mismo */
  presence: { id: string; name: string }[];
  /** Hasta cuándo animar el movimiento de tarjetas (al reordenar) */
  animateUntil: number;
  /** Mientras se arrastra no se aplican cambios remotos (evita que la tarjeta "salte") */
  dragging: boolean;
  busy: boolean;

  selectedId: string | null;
  selectedEdge: EdgeSelection | null;
  /** Panel derecho: sólo uno a la vez (persona o diseño), nunca encimados */
  panel: 'person' | 'design' | null;
  showMinimap: boolean;
  /** Al crear a alguien, el panel enfoca y selecciona el campo nombre */
  justCreatedId: string | null;
  focusMode: boolean;
  snap: boolean;
  exporting: boolean;
  fitRequest: number;
  centerRequest: { id: string; n: number } | null;
  cropTarget: { personId: string; file: File } | null;
  chooser: { a: string; b: string } | null;
  toasts: Toast[];

  load: (treeId: string) => Promise<void>;
  loadPublic: (token: string) => Promise<void>;
  /** Trae los cambios que hicieron otros editores, sin perder la selección */
  refreshFromServer: () => Promise<void>;
  reset: () => void;
  toast: (msg: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  select: (id: string | null) => void;
  focusPerson: (id: string) => void;
  openPanel: (panel: 'person' | 'design' | null) => void;
  set: (patch: Partial<EditorState>) => void;

  undo: () => Promise<void>;
  redo: () => Promise<void>;

  updateTree: (patch: Partial<Pick<Tree, 'name' | 'rootPersonId'>>) => Promise<void>;
  updateTheme: (patch: Partial<TreeSettings>) => Promise<void>;
  setLayoutMode: (mode: LayoutMode) => Promise<void>;

  createRelative: (kind: RelativeKind, ofId: string, at?: { x: number; y: number }) => Promise<void>;
  updatePerson: (id: string, patch: PersonInput) => Promise<void>;
  deletePerson: (id: string) => Promise<void>;
  deletePersons: (ids: string[]) => Promise<void>;
  savePositions: (items: { id: string; x: number; y: number }[]) => Promise<void>;
  runAutoLayout: () => Promise<void>;

  linkParent: (parentId: string, childId: string, kind?: ParentKind) => Promise<void>;
  setParentKind: (parentId: string, childId: string, kind: ParentKind) => Promise<void>;
  unlinkParent: (parentId: string, childId: string) => Promise<void>;
  addPartnership: (a: string, b: string, kind?: PartnerKind) => Promise<void>;
  setPartnershipKind: (id: string, kind: PartnerKind) => Promise<void>;
  deletePartnership: (id: string) => Promise<void>;
  deleteLinks: (sel: EdgeSelection) => Promise<void>;
}

let toastSeq = 0;
const HISTORY_LIMIT = 150;

const PLACEHOLDER: Record<RelativeKind, string> = {
  parent: 'Padre/Madre',
  child: 'Hijo/a',
  partner: 'Pareja',
  sibling: 'Hermano/a',
};

const samePc = (a: { parentId: string; childId: string }, b: { parentId: string; childId: string }) =>
  a.parentId === b.parentId && a.childId === b.childId;

export const useEditor = create<EditorState>((set, get) => {
  const treeId = () => get().tree!.id;
  const toastError = (e: unknown) => get().toast((e as Error).message, 'error');

  /** Ejecuta una mutación mostrando el error del servidor (p. ej. reglas de integridad) como aviso. */
  const guard = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      toastError(e);
      return undefined;
    }
  };

  const record = (cmd: Omit<Command, 'at'>) => {
    const past = get().past;
    const last = past[past.length - 1];
    const now = Date.now();
    if (cmd.mergeKey && last?.mergeKey === cmd.mergeKey && now - last.at < 1500) {
      // Mismo cambio repetido: conservar el "deshacer" original y actualizar el "rehacer"
      set({ past: [...past.slice(0, -1), { ...last, redo: cmd.redo, at: now }], future: [] });
    } else {
      set({ past: [...past, { ...cmd, at: now }].slice(-HISTORY_LIMIT), future: [] });
    }
  };

  // ---------- Cambios sólo locales ----------
  const L = {
    add(s: Partial<Snapshot>) {
      set((st) => ({
        persons: { ...st.persons, ...Object.fromEntries((s.persons ?? []).map((p) => [p.id, p])) },
        parentChild: [...st.parentChild.filter((r) => !(s.parentChild ?? []).some((n) => samePc(n, r))), ...(s.parentChild ?? [])],
        partnerships: [...st.partnerships.filter((p) => !(s.partnerships ?? []).some((n) => n.id === p.id)), ...(s.partnerships ?? [])],
      }));
    },
    removePersons(ids: string[]) {
      const gone = new Set(ids);
      set((st) => {
        const persons = { ...st.persons };
        ids.forEach((id) => delete persons[id]);
        return {
          persons,
          parentChild: st.parentChild.filter((r) => !gone.has(r.parentId) && !gone.has(r.childId)),
          partnerships: st.partnerships.filter((p) => !gone.has(p.personA) && !gone.has(p.personB)),
          selectedId: st.selectedId && gone.has(st.selectedId) ? null : st.selectedId,
          tree: st.tree && st.tree.rootPersonId && gone.has(st.tree.rootPersonId) ? { ...st.tree, rootPersonId: null } : st.tree,
        };
      });
    },
    positions(items: { id: string; x: number; y: number }[]) {
      set((st) => {
        const persons = { ...st.persons };
        for (const i of items) if (persons[i.id]) persons[i.id] = { ...persons[i.id], posX: i.x, posY: i.y };
        return { persons };
      });
    },
  };

  /** Lo necesario para reconstruir a unas personas con todos sus vínculos. */
  const snapshot = (ids: string[]): Snapshot => {
    const s = get();
    const set_ = new Set(ids);
    return {
      persons: ids.map((id) => s.persons[id]).filter(Boolean),
      parentChild: s.parentChild.filter((r) => set_.has(r.parentId) || set_.has(r.childId)),
      partnerships: s.partnerships.filter((p) => set_.has(p.personA) || set_.has(p.personB)),
    };
  };

  // ---------- Operaciones remotas (servidor + estado local), sin registrar historial ----------
  const R = {
    restore: async (snap: Snapshot) => L.add(await api.restore(treeId(), snap)),
    deletePersons: async (ids: string[]) => {
      await api.deletePersons(treeId(), ids);
      L.removePersons(ids);
    },
    updatePerson: async (id: string, patch: PersonInput) => {
      const p = await api.updatePerson(treeId(), id, patch);
      set((st) => ({ persons: { ...st.persons, [id]: p } }));
    },
    positions: async (items: { id: string; x: number; y: number }[]) => {
      L.positions(items);
      await api.savePositions(treeId(), items);
    },
    link: async (parentId: string, childId: string, kind?: ParentKind) =>
      L.add({ parentChild: [await api.linkParent(treeId(), parentId, childId, kind)] }),
    unlink: async (parentId: string, childId: string) => {
      await api.unlinkParent(treeId(), parentId, childId);
      set((st) => ({ parentChild: st.parentChild.filter((r) => !samePc(r, { parentId, childId })) }));
    },
    parentKind: async (parentId: string, childId: string, kind: ParentKind) =>
      L.add({ parentChild: [await api.updateParentKind(treeId(), parentId, childId, kind)] }),
    deletePartnership: async (id: string) => {
      await api.deletePartnership(treeId(), id);
      set((st) => ({ partnerships: st.partnerships.filter((x) => x.id !== id) }));
    },
    partnerKind: async (id: string, kind: PartnerKind) =>
      L.add({ partnerships: [await api.updatePartnership(treeId(), id, kind)] }),
    tree: async (patch: Partial<Pick<Tree, 'name' | 'rootPersonId' | 'theme'>>) => {
      if (patch.theme) set((st) => ({ tree: { ...st.tree!, theme: patch.theme! } })); // optimista
      const t = await api.updateTree(treeId(), patch);
      set((st) => ({ tree: { ...st.tree!, ...t } }));
    },
  };

  // Guardado diferido del diseño: arrastrar un selector de color genera decenas de cambios por segundo
  let themeTimer: ReturnType<typeof setTimeout> | undefined;
  const saveThemeSoon = () => {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => {
      const t = get().tree;
      if (t) api.updateTree(t.id, { theme: t.theme }).catch(toastError);
    }, 400);
  };

  /**
   * Reordena todo el árbol tras agregar o quitar personas/vínculos, salvo que el usuario lo haya desactivado
   * (en ese caso se respetan sus acomodos manuales). No se registra en el historial: forma parte del cambio.
   */
  const autoArrange = async () => {
    const s = get();
    if (!s.tree || s.readOnly || s.tree.theme.autoArrange === false) return;
    const pos = layoutFor(s.tree.theme.layoutMode ?? 'generations', Object.values(s.persons), s.parentChild, s.partnerships);
    const items = [...pos].map(([id, p]) => ({ id, ...p }));
    const changed = items.filter((i) => {
      const p = s.persons[i.id];
      return p && (p.posX !== i.x || p.posY !== i.y);
    });
    if (!changed.length) return;
    set({ animateUntil: Date.now() + 700 });
    await R.positions(changed);
  };

  const positionsOf = (ids: string[]) =>
    ids.map((id) => get().persons[id]).filter(Boolean).map((p) => ({ id: p.id, x: p.posX ?? 0, y: p.posY ?? 0 }));

  /** Pone los datos del árbol en el estado; si faltan posiciones las calcula (y las guarda sólo si se puede editar). */
  const hydrate = async (data: TreeData, readOnly: boolean) => {
    set({
      tree: data.tree,
      readOnly,
      persons: Object.fromEntries(data.persons.map((p) => [p.id, p])),
      parentChild: data.parentChild,
      partnerships: data.partnerships,
      selectedId: null,
      selectedEdge: null,
      panel: null,
      loading: false,
    });
    if (data.persons.some((p) => p.posX === null || p.posY === null)) {
      const s = get();
      const pos = layoutFor(s.tree!.theme.layoutMode ?? 'generations', Object.values(s.persons), s.parentChild, s.partnerships);
      const items = [...pos].map(([pid, p]) => ({ id: pid, ...p }));
      if (readOnly) L.positions(items);
      else await guard(() => R.positions(items));
    }
    set((s) => ({ fitRequest: s.fitRequest + 1 }));
  };

  return {
    user: null,
    readOnly: false,
    tree: null,
    persons: {},
    parentChild: [],
    partnerships: [],
    loading: false,
    past: [],
    future: [],
    presence: [],
    animateUntil: 0,
    dragging: false,
    busy: false,
    selectedId: null,
    selectedEdge: null,
    panel: null,
    showMinimap: typeof window === 'undefined' || window.innerWidth > 900,
    justCreatedId: null,
    focusMode: false,
    snap: false,
    exporting: false,
    fitRequest: 0,
    centerRequest: null,
    cropTarget: null,
    chooser: null,
    toasts: [],

    reset: () =>
      set({ readOnly: false, tree: null, persons: {}, parentChild: [], partnerships: [], selectedId: null, selectedEdge: null, past: [], future: [] }),
    set: (patch) => set(patch),

    toast: (msg, kind = 'info', action) => {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts, { id, msg, kind, action }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' || action ? 6000 : 3000);
    },

    load: async (id) => {
      set({ loading: true, past: [], future: [] });
      try {
        const data = await api.getTree(id);
        await hydrate(data, false);
      } catch (e) {
        set({ loading: false });
        toastError(e);
      }
    },

    refreshFromServer: async () => {
      const s = get();
      if (!s.tree || s.readOnly) return;
      if (s.dragging || s.busy) {
        setTimeout(() => get().refreshFromServer(), 600);
        return;
      }
      try {
        const data = await api.getTree(s.tree.id);
        set((st) => ({
          tree: { ...data.tree, role: st.tree?.role ?? data.tree.role },
          persons: Object.fromEntries(data.persons.map((p) => [p.id, p])),
          parentChild: data.parentChild,
          partnerships: data.partnerships,
          selectedId: st.selectedId && data.persons.some((p) => p.id === st.selectedId) ? st.selectedId : null,
          selectedEdge: null,
        }));
      } catch {
        // 404: borraron el árbol o te quitaron el acceso
        set({ tree: null });
        get().toast('Ya no tienes acceso a este árbol', 'error');
      }
    },

    loadPublic: async (token) => {
      set({ loading: true, past: [], future: [] });
      try {
        await hydrate(await api.getPublicTree(token), true);
      } catch {
        set({ loading: false, tree: null });
      }
    },

    // Elegir a alguien abre su ficha (reemplaza al panel de diseño); deseleccionar sólo cierra la ficha
    select: (id) =>
      set((s) => ({
        selectedId: id,
        selectedEdge: null,
        justCreatedId: null,
        panel: id ? 'person' : s.panel === 'person' ? null : s.panel,
      })),
    openPanel: (panel) => set({ panel }),
    focusPerson: (id) =>
      set((s) => ({ selectedId: id, selectedEdge: null, justCreatedId: null, panel: 'person', centerRequest: { id, n: (s.centerRequest?.n ?? 0) + 1 } })),

    // ---------- Historial ----------
    undo: async () => {
      const { past, busy } = get();
      const cmd = past[past.length - 1];
      if (!cmd || busy) return;
      set({ busy: true });
      try {
        await cmd.undo();
        if (cmd.structural) await autoArrange().catch(toastError);
        // los avisos con botón "Deshacer" ya no aplican
        set((s) => ({ past: s.past.slice(0, -1), future: [...s.future, cmd], toasts: s.toasts.filter((t) => !t.action) }));
        get().toast(`Deshecho: ${cmd.label}`);
      } catch (e) {
        toastError(e);
      } finally {
        set({ busy: false });
      }
    },
    redo: async () => {
      const { future, busy } = get();
      const cmd = future[future.length - 1];
      if (!cmd || busy) return;
      set({ busy: true });
      try {
        await cmd.redo();
        if (cmd.structural) await autoArrange().catch(toastError);
        set((s) => ({ future: s.future.slice(0, -1), past: [...s.past, cmd] }));
        get().toast(`Rehecho: ${cmd.label}`);
      } catch (e) {
        toastError(e);
      } finally {
        set({ busy: false });
      }
    },

    // ---------- Árbol y diseño ----------
    updateTree: (patch) =>
      guard(async () => {
        const t = get().tree!;
        const before = Object.fromEntries(Object.keys(patch).map((k) => [k, t[k as keyof Tree]])) as typeof patch;
        await R.tree(patch);
        record({
          label: patch.rootPersonId !== undefined ? 'Cambiar persona central' : 'Renombrar árbol',
          undo: () => R.tree(before),
          redo: () => R.tree(patch),
        });
      }),

    updateTheme: (patch) =>
      guard(async () => {
        const before = get().tree!.theme;
        const after = { ...before, ...patch };
        set((st) => ({ tree: { ...st.tree!, theme: after } }));
        saveThemeSoon();
        record({
          label: 'Cambiar diseño',
          mergeKey: `theme:${Object.keys(patch).join(',')}`,
          undo: () => R.tree({ theme: before }),
          redo: () => R.tree({ theme: after }),
        });
      }),

    setLayoutMode: (mode) =>
      guard(async () => {
        const s = get();
        const beforeTheme = s.tree!.theme;
        const afterTheme = { ...beforeTheme, layoutMode: mode };
        const ids = Object.keys(s.persons);
        const beforePos = positionsOf(ids);
        const pos = layoutFor(mode, Object.values(s.persons), s.parentChild, s.partnerships);
        const afterPos = [...pos].map(([id, p]) => ({ id, ...p }));
        const apply = async (theme: TreeSettings, items: typeof afterPos) => {
          await R.tree({ theme });
          await R.positions(items);
          set((st) => ({ fitRequest: st.fitRequest + 1 }));
        };
        await apply(afterTheme, afterPos);
        record({ label: 'Cambiar forma del árbol', undo: () => apply(beforeTheme, beforePos), redo: () => apply(afterTheme, afterPos) });
      }),

    // ---------- Personas ----------
    createRelative: (kind, ofId, at) =>
      guard(async () => {
        const { persons, parentChild, partnerships, tree } = get();
        const mode = tree!.theme.layoutMode ?? 'generations';
        const of = persons[ofId];
        const all = Object.values(persons);
        const parentsOf = parentChild.filter((r) => r.childId === ofId);
        const partnersOf = partnerships
          .filter((p) => p.personA === ofId || p.personB === ofId)
          .map((p) => ({ id: p.personA === ofId ? p.personB : p.personA, kind: p.kind }));

        const body: Parameters<typeof api.createPerson>[1] = {
          person: { firstName: PLACEHOLDER[kind], gender: 'unknown' },
        };
        let anchor = { x: of.posX ?? 0, y: of.posY ?? 0 };

        if (kind === 'parent') {
          body.children = [ofId];
          const existing = parentsOf.filter((r) => r.kind === 'biological');
          if (existing.length >= 2) throw new Error('Ya tiene dos padres. Para padrastros, vincula desde el panel.');
          if (existing.length === 1) {
            const other = persons[existing[0].parentId];
            body.partners = [other.id]; // el segundo progenitor queda como pareja del primero
            body.person.gender = other.gender === 'male' ? 'female' : other.gender === 'female' ? 'male' : 'unknown';
            body.person.firstName = body.person.gender === 'female' ? 'Madre' : body.person.gender === 'male' ? 'Padre' : 'Padre/Madre';
            anchor = { x: other.posX ?? anchor.x, y: other.posY ?? anchor.y };
          }
        } else if (kind === 'child') {
          body.parents = [{ id: ofId }];
          const current = partnersOf.filter((p) => p.kind !== 'divorced' && p.kind !== 'separated');
          if (current.length === 1) body.parents.push({ id: current[0].id });
          const siblings = parentChild.filter((r) => r.parentId === ofId).map((r) => persons[r.childId]);
          if (siblings.length && mode !== 'radial') {
            const last = siblings.reduce((a, b) => ((a.posX ?? 0) > (b.posX ?? 0) ? a : b));
            anchor = { x: last.posX ?? anchor.x, y: last.posY ?? anchor.y };
          }
        } else if (kind === 'partner') {
          body.partners = [ofId];
          body.person.gender = of.gender === 'male' ? 'female' : of.gender === 'female' ? 'male' : 'unknown';
        } else {
          if (!parentsOf.length) throw new Error('Agrega primero al padre o la madre para poder agregar hermanos.');
          body.parents = parentsOf.map((r) => ({ id: r.parentId, kind: r.kind }));
        }
        // Un hijo junto a sus hermanos va al lado, no una generación más abajo
        const spotKind = kind === 'child' && anchor.x !== (of.posX ?? 0) ? 'sibling' : kind === 'parent' && body.partners ? 'partner' : kind;
        const spot = at ?? relativeSpot(mode, spotKind, anchor, all);
        body.person.posX = spot.x;
        body.person.posY = spot.y;

        const res = await api.createPerson(treeId(), body);
        L.add({ persons: [res.person], parentChild: res.parentChild, partnerships: res.partnerships });
        set({ selectedId: res.person.id, selectedEdge: null, justCreatedId: res.person.id, panel: 'person' });
        const snap: Snapshot = { persons: [res.person], parentChild: res.parentChild, partnerships: res.partnerships };
        record({
          label: `Agregar ${PLACEHOLDER[kind].toLowerCase()}`,
          structural: true,
          undo: () => R.deletePersons([res.person.id]),
          redo: () => R.restore(snap),
        });
        if (!at) {
          await autoArrange();
          // seguir a la persona nueva: el lienzo se centra en ella
          set((st) => ({ centerRequest: { id: res.person.id, n: (st.centerRequest?.n ?? 0) + 1 } }));
        }
      }),

    updatePerson: (id, patch) =>
      guard(async () => {
        const old = get().persons[id];
        const before = Object.fromEntries(Object.keys(patch).map((k) => [k, old[k as keyof Person]])) as PersonInput;
        await R.updatePerson(id, patch);
        const keys = Object.keys(patch);
        record({
          label: keys.includes('photoUrl') ? 'Cambiar foto' : keys.includes('color') ? 'Cambiar color' : `Editar a ${old.firstName}`,
          mergeKey: keys.includes('color') ? `color:${id}` : undefined,
          undo: () => R.updatePerson(id, before),
          redo: () => R.updatePerson(id, patch),
        });
      }),

    deletePerson: (id) => get().deletePersons([id]),

    deletePersons: (ids) =>
      guard(async () => {
        if (!ids.length) return;
        const snap = snapshot(ids);
        const wasRoot = get().tree!.rootPersonId;
        const rootDeleted = wasRoot && ids.includes(wasRoot) ? wasRoot : null;
        await R.deletePersons(ids);
        const label = ids.length === 1 ? `Eliminar a ${fullName(snap.persons[0])}` : `Eliminar ${ids.length} personas`;
        record({
          label,
          structural: true,
          undo: async () => {
            await R.restore(snap);
            if (rootDeleted) await R.tree({ rootPersonId: rootDeleted });
          },
          redo: () => R.deletePersons(ids),
        });
        await autoArrange();
        const msg = ids.length === 1 ? `Eliminado: ${fullName(snap.persons[0])}` : `Eliminadas ${ids.length} personas`;
        get().toast(msg, 'info', { label: 'Deshacer', run: () => get().undo() });
      }),

    savePositions: async (items) => {
      if (!items.length) return;
      const before = positionsOf(items.map((i) => i.id));
      const moved = items.some((i, k) => i.x !== before[k]?.x || i.y !== before[k]?.y);
      await guard(async () => {
        await R.positions(items);
        if (moved) record({ label: items.length === 1 ? 'Mover tarjeta' : `Mover ${items.length} tarjetas`, undo: () => R.positions(before), redo: () => R.positions(items) });
      });
    },

    runAutoLayout: () =>
      guard(async () => {
        const s = get();
        const ids = Object.keys(s.persons);
        const before = positionsOf(ids);
        const pos = layoutFor(s.tree!.theme.layoutMode ?? 'generations', Object.values(s.persons), s.parentChild, s.partnerships);
        const after = [...pos].map(([id, p]) => ({ id, ...p }));
        const apply = async (items: typeof after) => {
          set({ animateUntil: Date.now() + 700 });
          await R.positions(items);
          set((st) => ({ fitRequest: st.fitRequest + 1 }));
        };
        await apply(after);
        record({ label: 'Ordenar árbol', undo: () => apply(before), redo: () => apply(after) });
      }),

    // ---------- Vínculos ----------
    linkParent: (parentId, childId, kind) =>
      guard(async () => {
        await R.link(parentId, childId, kind);
        const k = get().parentChild.find((r) => samePc(r, { parentId, childId }))?.kind;
        record({ label: 'Vincular padre/hijo', structural: true, undo: () => R.unlink(parentId, childId), redo: () => R.link(parentId, childId, k) });
        await autoArrange();
        get().toast('Relación padre/hijo creada');
      }),

    setParentKind: (parentId, childId, kind) =>
      guard(async () => {
        const old = get().parentChild.find((r) => samePc(r, { parentId, childId }))!.kind;
        await R.parentKind(parentId, childId, kind);
        record({ label: 'Cambiar tipo de vínculo', undo: () => R.parentKind(parentId, childId, old), redo: () => R.parentKind(parentId, childId, kind) });
      }),

    unlinkParent: (parentId, childId) =>
      guard(async () => {
        const old = get().parentChild.find((r) => samePc(r, { parentId, childId }))!;
        await R.unlink(parentId, childId);
        record({ label: 'Quitar vínculo', structural: true, undo: () => R.link(parentId, childId, old.kind), redo: () => R.unlink(parentId, childId) });
        await autoArrange();
      }),

    addPartnership: (a, b, kind) =>
      guard(async () => {
        const p = await api.addPartnership(treeId(), a, b, kind);
        L.add({ partnerships: [p] });
        record({
          label: 'Vincular pareja',
          structural: true,
          undo: () => R.deletePartnership(p.id),
          redo: () => R.restore({ persons: [], parentChild: [], partnerships: [p] }),
        });
        await autoArrange();
        get().toast('Pareja vinculada');
      }),

    setPartnershipKind: (id, kind) =>
      guard(async () => {
        const old = get().partnerships.find((x) => x.id === id)!.kind;
        await R.partnerKind(id, kind);
        record({ label: 'Cambiar tipo de pareja', undo: () => R.partnerKind(id, old), redo: () => R.partnerKind(id, kind) });
      }),

    deletePartnership: (id) =>
      guard(async () => {
        const p = get().partnerships.find((x) => x.id === id)!;
        await R.deletePartnership(id);
        record({
          label: 'Quitar pareja',
          structural: true,
          undo: () => R.restore({ persons: [], parentChild: [], partnerships: [p] }),
          redo: () => R.deletePartnership(id),
        });
        await autoArrange();
      }),

    /** Quita de una vez todos los vínculos de una línea (p. ej. ambos padres → hijo). */
    deleteLinks: (sel) =>
      guard(async () => {
        const s = get();
        const pcRows = s.parentChild.filter((r) => sel.pc.some((x) => samePc(x, r)));
        const partner = sel.partnershipId ? s.partnerships.find((p) => p.id === sel.partnershipId) : undefined;
        const doIt = async () => {
          for (const r of pcRows) await R.unlink(r.parentId, r.childId);
          if (partner) await R.deletePartnership(partner.id);
        };
        await doIt();
        set({ selectedEdge: null });
        record({
          label: 'Quitar vínculo',
          structural: true,
          undo: () => R.restore({ persons: [], parentChild: pcRows, partnerships: partner ? [partner] : [] }),
          redo: doIt,
        });
        await autoArrange();
        get().toast('Vínculo eliminado', 'info', { label: 'Deshacer', run: () => get().undo() });
      }),
  };
});
