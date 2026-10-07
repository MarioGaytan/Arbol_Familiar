import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ArrowLeft, Crosshair, Download, Eye, Focus, Grid3x3, LayoutGrid, Palette, Redo2, Search, Share2, Undo2, X,
} from 'lucide-react';
import { useEditor } from '../store';
import { fullName, initials, lifespan } from '../lib/format';
import { FamilyCanvas, useDerived } from './FamilyCanvas';
import { PersonPanel } from './PersonPanel';
import { PhotoCropper } from './PhotoCropper';
import { ThemePanel } from './ThemePanel';
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
        <details>
        <summary>Consejos y atajos</summary>
        <ul>
          <li>Arrastra desde el punto <b>inferior</b> de una tarjeta a un espacio vacío para crear un hijo; desde el <b>superior</b>, un padre; desde un <b>lado</b>, una pareja.</li>
          <li>Conecta dos tarjetas existentes arrastrando entre sus puntos.</li>
          <li>Arrastra una foto sobre una tarjeta para ponerla.</li>
          <li><kbd>Shift</kbd> + arrastrar para seleccionar varias y moverlas juntas.</li>
          <li><kbd>Supr</kbd> borra lo seleccionado; haz clic en una línea para quitar ese vínculo.</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshace, <kbd>Ctrl</kbd>+<kbd>Y</kbd> rehace.</li>
        </ul>
        </details>
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
              <button className={`btn ${s.panel === 'design' ? 'active' : ''}`} onClick={() => s.openPanel(s.panel === 'design' ? null : 'design')} title="Diseño: colores, tipografía y forma del árbol">
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
          {s.panel === 'design' && !ro ? <ThemePanel /> : s.panel === 'person' ? <PersonPanel /> : null}
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
