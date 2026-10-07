import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ArrowLeft, Crosshair, Download, Eye, Focus, Grid3x3, LayoutGrid, Palette, Redo2, Search, Share2, Undo2, X,
} from 'lucide-react';
import { useEditor } from '../store';
import { fullName, initials, lifespan } from '../lib/format';
import { resolveTheme, THEMES } from '../lib/themes';
import type { EdgeStyle, LayoutMode, Pattern, PhotoShape } from '../types';
import { FamilyCanvas, useDerived } from './FamilyCanvas';
import { PersonPanel } from './PersonPanel';
import { PhotoCropper } from './PhotoCropper';
import { ShareDialog } from './ShareDialog';
import { useLiveSync } from '../lib/useLiveSync';

// jsPDF + html-to-image sólo se descargan al abrir el diálogo de exportación
const ExportDialog = lazy(() => import('./ExportDialog').then((m) => ({ default: m.ExportDialog })));

function Sidebar() {
  const persons = useEditor((s) => s.persons);
  const selectedId = useEditor((s) => s.selectedId);
  const focusPerson = useEditor((s) => s.focusPerson);
  const { relations } = useDerived();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const nq = norm(q.trim());
    return Object.values(persons)
      .filter((p) => !nq || norm(`${fullName(p)} ${relations.get(p.id) ?? ''} ${p.birthPlace ?? ''}`).includes(nq))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  }, [persons, relations, q]);

  return (
    <aside className="sidebar">
      <div className="search">
        <Search size={16} />
        <input placeholder="Buscar persona, parentesco, lugar…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="icon-btn" onClick={() => setQ('')}><X size={14} /></button>}
      </div>
      <div className="people">
        {list.map((p) => (
          <button key={p.id} className={`person-row ${selectedId === p.id ? 'on' : ''}`} onClick={() => focusPerson(p.id)}>
            <span className="mini-avatar">{p.photoUrl ? <img src={p.photoUrl} alt="" /> : initials(p)}</span>
            <span className="pr-text">
              <strong>{fullName(p)}</strong>
              <small>{[relations.get(p.id), lifespan(p)].filter(Boolean).join(' · ')}</small>
            </span>
          </button>
        ))}
        {!list.length && <p className="empty">Sin resultados</p>}
      </div>
      <div className="legend edit-only">
        <strong>Consejos</strong>
        <ul>
          <li>Arrastra desde el punto <b>inferior</b> de una tarjeta a un espacio vacío para crear un hijo; desde el <b>superior</b>, un padre; desde un <b>lado</b>, una pareja.</li>
          <li>Conecta dos tarjetas existentes arrastrando entre sus puntos.</li>
          <li>Arrastra una foto sobre una tarjeta para ponerla.</li>
          <li><kbd>Shift</kbd> + arrastrar para seleccionar varias y moverlas juntas.</li>
          <li><kbd>Supr</kbd> borra lo seleccionado; haz clic en una línea para quitar ese vínculo.</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshace, <kbd>Ctrl</kbd>+<kbd>Y</kbd> rehace.</li>
        </ul>
      </div>
    </aside>
  );
}

const LAYOUT_MODES: [LayoutMode, string, string][] = [
  ['generations', 'Generaciones', 'De arriba hacia abajo'],
  ['tree', 'Árbol', 'Crece hacia arriba desde un tronco'],
  ['radial', 'Radial', 'Anillos desde el centro'],
];

function ModeIcon({ mode }: { mode: LayoutMode }) {
  const c = 'currentColor';
  if (mode === 'tree')
    return (
      <svg viewBox="0 0 48 40" width="48" height="40">
        <path d="M22 39 C22 30 23 26 24 22 C25 26 26 30 26 39 Z" fill={c} />
        <path d="M24 23 C20 18 12 18 10 12 M24 23 C28 18 36 18 38 12 M24 22 L24 8" stroke={c} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {[[10, 9], [24, 6], [38, 9]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="4.5" fill={c} opacity=".55" />)}
      </svg>
    );
  if (mode === 'radial')
    return (
      <svg viewBox="0 0 48 40" width="48" height="40">
        <circle cx="24" cy="20" r="9" stroke={c} fill="none" strokeDasharray="2 3" opacity=".6" />
        <circle cx="24" cy="20" r="17" stroke={c} fill="none" strokeDasharray="2 3" opacity=".6" />
        <circle cx="24" cy="20" r="4" fill={c} />
        {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={24 + 17 * Math.sin((a * Math.PI) / 180)} cy={20 - 17 * Math.cos((a * Math.PI) / 180)} r="3.5" fill={c} opacity=".55" />)}
      </svg>
    );
  return (
    <svg viewBox="0 0 48 40" width="48" height="40">
      <rect x="18" y="3" width="12" height="9" rx="2" fill={c} />
      <path d="M24 12 V18 M10 18 H38 M10 18 V24 M24 18 V24 M38 18 V24" stroke={c} strokeWidth="2" fill="none" />
      {[10, 24, 38].map((x) => <rect key={x} x={x - 6} y="25" width="12" height="9" rx="2" fill={c} opacity=".55" />)}
    </svg>
  );
}

function ThemePanel({ onClose }: { onClose: () => void }) {
  const tree = useEditor((s) => s.tree)!;
  const updateTheme = useEditor((s) => s.updateTheme);
  const setLayoutMode = useEditor((s) => s.setLayoutMode);
  const t = resolveTheme(tree.theme);
  const seg = <T extends string>(value: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="segmented">
      {opts.map(([k, l]) => (
        <button key={k} className={value === k ? 'on' : ''} onClick={() => on(k)}>{l}</button>
      ))}
    </div>
  );

  return (
    <aside className="panel">
      <header className="panel-head">
        <div className="panel-title"><strong>Diseño</strong></div>
        <button className="icon-btn" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="panel-body">
        <h4>Forma del árbol</h4>
        <div className="modes">
          {LAYOUT_MODES.map(([k, title, desc]) => (
            <button key={k} className={`mode-card ${(tree.theme.layoutMode ?? 'generations') === k ? 'on' : ''}`} onClick={() => tree.theme.layoutMode !== k && setLayoutMode(k)}>
              <ModeIcon mode={k} />
              <strong>{title}</strong>
              <small>{desc}</small>
            </button>
          ))}
        </div>

        <h4>Estilos prediseñados</h4>
        <div className="presets">
          {THEMES.map((th) => (
            <button
              key={th.id}
              className={`preset ${t.id === th.id ? 'on' : ''}`}
              onClick={() => updateTheme({ preset: th.id, accent: undefined, edgeColor: undefined, background: undefined, photoShape: undefined, edgeStyle: undefined, pattern: undefined })}
              style={{ background: th.bg, color: th.text, fontFamily: th.nameFont }}
            >
              <span className="preset-card" style={{ background: th.cardBg, borderColor: th.cardBorder, borderRadius: th.radius / 2 }}>
                <i style={{ background: th.accent, borderRadius: th.photoShape === 'circle' ? '50%' : 4 }} />
              </span>
              {th.name}
            </button>
          ))}
        </div>

        <h4>Colores</h4>
        <div className="color-rows">
          <label>Acento <input type="color" value={t.accent} onChange={(e) => updateTheme({ accent: e.target.value })} /></label>
          <label>Líneas <input type="color" value={t.edge} onChange={(e) => updateTheme({ edgeColor: e.target.value })} /></label>
          <label>Fondo <input type="color" value={t.bg} onChange={(e) => updateTheme({ background: e.target.value })} /></label>
        </div>

        <h4>Forma de la foto</h4>
        {seg<PhotoShape>(t.photoShape, [['circle', 'Círculo'], ['rounded', 'Redondeada'], ['square', 'Cuadrada']], (v) => updateTheme({ photoShape: v }))}

        <h4>Líneas de conexión</h4>
        {seg<EdgeStyle>(t.edgeStyle, [['smoothstep', 'Escalón suave'], ['step', 'Escalón'], ['default', 'Curva'], ['straight', 'Recta'], ['branch', 'Rama']], (v) => updateTheme({ edgeStyle: v }))}

        <h4>Fondo del lienzo</h4>
        {seg<Pattern>(t.pattern, [['dots', 'Puntos'], ['lines', 'Cuadrícula'], ['cross', 'Cruces'], ['none', 'Liso']], (v) => updateTheme({ pattern: v }))}

        <h4>Mostrar</h4>
        <label className="check">
          <input type="checkbox" checked={t.showDates} onChange={(e) => updateTheme({ showDates: e.target.checked })} /> Fechas
        </label>
        <label className="check">
          <input type="checkbox" checked={t.showRelations} onChange={(e) => updateTheme({ showRelations: e.target.checked })} /> Parentesco con la persona central
        </label>
      </div>
    </aside>
  );
}

function RelationChooser() {
  const chooser = useEditor((s) => s.chooser);
  const persons = useEditor((s) => s.persons);
  const s = useEditor();
  if (!chooser) return null;
  const a = persons[chooser.a];
  const b = persons[chooser.b];
  const close = () => s.set({ chooser: null });
  const pick = (fn: () => void) => {
    fn();
    close();
  };
  return (
    <div className="modal-bg" onMouseDown={close}>
      <div className="modal chooser" onMouseDown={(e) => e.stopPropagation()}>
        <h3>¿Qué relación tienen?</h3>
        <p className="muted">{fullName(a)} es…</p>
        <div className="chooser-opts">
          <button className="btn" onClick={() => pick(() => s.linkParent(a.id, b.id))}>padre/madre de {b.firstName}</button>
          <button className="btn" onClick={() => pick(() => s.linkParent(b.id, a.id))}>hijo/a de {b.firstName}</button>
          <button className="btn" onClick={() => pick(() => s.addPartnership(a.id, b.id))}>pareja de {b.firstName}</button>
        </div>
        <button className="btn ghost" onClick={close}>Cancelar</button>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.msg}
          {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export function Editor({ onBack }: { onBack: () => void }) {
  const s = useEditor();
  const [showTheme, setShowTheme] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [name, setName] = useState(s.tree?.name ?? '');
  const treeName = s.tree?.name;
  useEffect(() => setName(treeName ?? ''), [treeName]);
  useLiveSync(s.tree?.id, !!s.tree && !s.readOnly);
  if (!s.tree) {
    return (
      <div className="loading">
        {s.loading ? 'Cargando árbol…' : (
          <div className="not-found">
            <p>Este árbol no existe, el enlace se desactivó o no tienes acceso.</p>
            <button className="btn" onClick={onBack}>Ir al inicio</button>
          </div>
        )}
      </div>
    );
  }
  const root = s.tree.rootPersonId;
  const ro = s.readOnly;
  const isOwner = s.tree.role === 'owner';

  return (
    <ReactFlowProvider>
      <div className={`editor ${ro ? 'read-only' : ''}`}>
        <header className="topbar">
          <button className="icon-btn" onClick={onBack} title={ro ? 'Ir al inicio' : 'Mis árboles'}><ArrowLeft size={18} /></button>
          {ro ? (
            <strong className="tree-name ro">{s.tree.name}</strong>
          ) : (
            <input
              className="tree-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== s.tree!.name && s.updateTree({ name: name.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
            />
          )}
          {ro ? (
            <span className="ro-badge"><Eye size={13} /> Sólo lectura</span>
          ) : (
            <span className="count">{Object.keys(s.persons).length} personas</span>
          )}
          <div className="spacer" />
          {s.presence.length > 0 && (
            <div className="presence" title={`También aquí: ${s.presence.map((p) => p.name).join(', ')}`}>
              {s.presence.slice(0, 4).map((p) => (
                <span key={p.id} className="presence-dot">{p.name[0]?.toUpperCase()}</span>
              ))}
              <small>en línea</small>
            </div>
          )}
          {!ro && (
            <>
              <button
                className="btn"
                disabled={!s.past.length || s.busy}
                onClick={() => s.undo()}
                title={s.past.length ? `Deshacer: ${s.past[s.past.length - 1].label} (Ctrl+Z)` : 'Nada que deshacer'}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="btn"
                disabled={!s.future.length || s.busy}
                onClick={() => s.redo()}
                title={s.future.length ? `Rehacer: ${s.future[s.future.length - 1].label} (Ctrl+Y)` : 'Nada que rehacer'}
              >
                <Redo2 size={16} />
              </button>
              <span className="sep" />
              <button className="btn" onClick={() => s.runAutoLayout()} title="Reorganizar por generaciones">
                <LayoutGrid size={16} /> <span>Ordenar</span>
              </button>
            </>
          )}
          <button className="btn" onClick={() => s.set({ fitRequest: s.fitRequest + 1 })} title="Ver todo el árbol">
            <Focus size={16} /> <span>Ver todo</span>
          </button>
          <button className="btn" disabled={!root} onClick={() => root && s.focusPerson(root)} title="Ir a la persona central">
            <Crosshair size={16} /> <span>Central</span>
          </button>
          <button className={`btn ${s.focusMode ? 'active' : ''}`} onClick={() => s.set({ focusMode: !s.focusMode })} title="Atenuar a quienes no están en el camino de parentesco">
            <Search size={16} /> <span>Rastrear</span>
          </button>
          {!ro && (
            <>
              <button className={`btn ${s.snap ? 'active' : ''}`} onClick={() => s.set({ snap: !s.snap })} title="Alinear a cuadrícula al mover">
                <Grid3x3 size={16} />
              </button>
              <button className={`btn ${showTheme ? 'active' : ''}`} onClick={() => setShowTheme((v) => !v)}>
                <Palette size={16} /> <span>Diseño</span>
              </button>
            </>
          )}
          {isOwner && (
            <button className="btn" onClick={() => setShowShare(true)} title="Invitar editores o crear un enlace público">
              <Share2 size={16} /> <span>Compartir</span>
            </button>
          )}
          <button className="btn primary" onClick={() => setShowExport(true)}>
            <Download size={16} /> <span>Exportar</span>
          </button>
        </header>
        <div className="editor-body">
          <Sidebar />
          <main className="canvas-main">
            <FamilyCanvas />
            {Object.keys(s.persons).length === 0 && (
              <div className="empty-canvas">
                <p>Este árbol está vacío.</p>
              </div>
            )}
          </main>
          {showTheme && !ro ? <ThemePanel onClose={() => setShowTheme(false)} /> : <PersonPanel />}
        </div>
        {!ro && <PhotoCropper />}
        {!ro && <RelationChooser />}
        {showShare && <ShareDialog onClose={() => setShowShare(false)} />}
        {showExport && (
          <Suspense fallback={null}>
            <ExportDialog onClose={() => setShowExport(false)} />
          </Suspense>
        )}
      </div>
    </ReactFlowProvider>
  );
}
