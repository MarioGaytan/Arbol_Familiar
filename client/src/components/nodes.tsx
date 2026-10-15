import { memo, useState, type CSSProperties, type DragEvent } from 'react';
import { Handle, NodeToolbar, Position, useStore, type NodeProps } from '@xyflow/react';
import { Baby, Heart, Star, UserPlus, Users } from 'lucide-react';
import { UNION_H, type DecorFlowNode, type PersonFlowNode, type UnionFlowNode } from '../lib/graph';
import { cubic, line, polyline, taper, verticalCurve, type Pt } from '../lib/branch';
import type { Limb } from '../lib/crown';
import { ageText, initials } from '../lib/format';
import { useEditor } from '../store';

/** Por debajo de este zoom las tarjetas pasan a modo "lejos": sólo foto y nombre en grande. */
const FAR_ZOOM = 0.5;
/** Devuelve un booleano: los componentes sólo se vuelven a dibujar al cruzar el umbral, no en cada zoom. */
export const useFar = () => useStore((st) => st.transform[2] < FAR_ZOOM);

export const PersonNode = memo(function PersonNode({ id, data, selected }: NodeProps<PersonFlowNode>) {
  const { person, relation, isRoot, highlight, dim } = data;
  const createRelative = useEditor((s) => s.createRelative);
  const setStore = useEditor((s) => s.set);
  const exporting = useEditor((s) => s.exporting);
  const readOnly = useEditor((s) => s.readOnly);
  const showDates = useEditor((s) => s.tree?.theme.showDates ?? true);
  const showRelations = useEditor((s) => s.tree?.theme.showRelations ?? true);
  const [dropping, setDropping] = useState(false);
  // De lejos sólo se ven foto y nombre: menos nodos en el DOM y el nombre se lee a cualquier zoom
  const far = useFar() && !exporting;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const file = e.dataTransfer.files?.[0];
    if (!readOnly && file?.type.startsWith('image/')) setStore({ cropTarget: { personId: id, file } });
  };

  const cls = [
    'person',
    `g-${person.gender}`,
    selected && !exporting ? 'is-selected' : '',
    highlight && !exporting ? 'is-hl' : '',
    dim && !exporting ? 'is-dim' : '',
    dropping ? 'is-drop' : '',
    person.deathDate ? 'is-deceased' : '',
  ].join(' ');
  const style = person.color ? ({ '--accent': person.color, '--card-border': person.color } as CSSProperties) : undefined;
  const born = person.birthDate?.slice(0, 4);
  const died = person.deathDate?.slice(0, 4);
  const ageLabel = ageText(person);

  return (
    <>
      <NodeToolbar isVisible={selected && !exporting && !readOnly && !far} position={Position.Bottom} offset={14}>
        <div className="quick-add">
          <button onClick={() => createRelative('parent', id)} title="Agregar padre o madre">
            <Users size={15} /> Padre/Madre
          </button>
          <button onClick={() => createRelative('partner', id)} title="Agregar pareja">
            <Heart size={15} /> Pareja
          </button>
          <button onClick={() => createRelative('child', id)} title="Agregar hijo o hija">
            <Baby size={15} /> Hijo/a
          </button>
          <button onClick={() => createRelative('sibling', id)} title="Agregar hermano o hermana">
            <UserPlus size={15} /> Hermano/a
          </button>
        </div>
      </NodeToolbar>

      <div
        className={cls}
        style={style}
        onDragOver={(e) => {
          if (!readOnly && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        <Handle type="source" position={Position.Top} id="t" className="h h-t" title="Arrastra para conectar un padre/madre" />
        <Handle type="source" position={Position.Left} id="l" className="h h-side" title="Arrastra para conectar una pareja" />
        <Handle type="source" position={Position.Right} id="r" className="h h-side" title="Arrastra para conectar una pareja" />
        <Handle type="source" position={Position.Bottom} id="b" className="h h-b" title="Arrastra para conectar un hijo/a" />

        {isRoot && (
          <span className="root-badge" title="Persona central">
            <Star size={11} fill="currentColor" />
          </span>
        )}
        <div className="avatar">
          {person.photoUrl ? (
            <img src={person.photoUrl} alt="" draggable={false} loading="lazy" decoding="async" />
          ) : (
            <span>{initials(person)}</span>
          )}
        </div>
        {far ? (
          <div className="p-text">
            <div className="p-name" title={[person.firstName, person.lastName].filter(Boolean).join(' ')}>
              {person.firstName || initials(person)}
            </div>
          </div>
        ) : (
          <>
            <div className="p-text">
              <div className="p-name" title={[person.firstName, person.lastName].filter(Boolean).join(' ')}>
                {person.firstName}
              </div>
              <div className="p-last">{person.lastName || ' '}</div>
              {showDates && (born || died) && (
                <div className="p-dates">
                  {born ? (died ? `${born} – ${died}` : `n. ${born}`) : `† ${died}`}
                  {ageLabel && <span className="p-age">{died ? ` · ${ageLabel}` : ` · ${ageLabel}`}</span>}
                </div>
              )}
            </div>
            {showRelations && relation && <div className={`p-rel ${isRoot ? 'root' : ''}`}>{relation}</div>}
          </>
        )}
      </div>
    </>
  );
});

export const UnionNode = memo(function UnionNode({ data }: NodeProps<UnionFlowNode>) {
  const up = data.mode === 'tree';
  const branch = data.organic && data.mode !== 'radial';
  const w = data.w;
  // Rama de la pareja: gruesa y con nudo donde se unen, más fina hacia donde brotan los hijos
  const [inY, outY] = up ? [UNION_H, 0] : [0, UNION_H];
  const stem = branch ? taper(cubic({ x: w / 2, y: inY }, { x: w / 2, y: inY }, { x: w / 2, y: outY }, { x: w / 2, y: outY }, 12), w * 1.7, w * 0.8) : '';
  return (
    <div
      className={`union ${data.mode === 'radial' ? 'dot' : ''} ${branch ? 'branchy' : ''} ${data.hl ? 'hl' : ''} ${data.dim ? 'dim' : ''}`}
      style={data.mode === 'radial' ? undefined : { width: w, borderRadius: w }}
    >
      {branch && (
        <svg width={w} height={UNION_H} className="union-svg">
          <path d={stem} />
          <ellipse cx={w / 2} cy={inY} rx={w * 1.05} ry={w * 0.75} />
        </svg>
      )}
      <Handle type="target" position={up ? Position.Bottom : Position.Top} id="in" isConnectable={false} className="union-h" />
      <Handle type="source" position={up ? Position.Top : Position.Bottom} id="out" isConnectable={false} className="union-h" />
    </div>
  );
});

/** Rama: sale inclinada de la bifurcación y llega vertical; las finales siguen rectas hasta la pareja. */
function limbPath(l: Limb): Pt[] {
  const dx = l.to.x - l.from.x;
  const dy = l.from.y - l.to.y;
  const curve = cubic(l.from, { x: l.from.x + dx * 0.45, y: l.from.y - dy * 0.2 }, { x: l.to.x, y: l.to.y + dy * 0.45 }, l.to);
  return l.tip ? [...curve, ...line(l.to, l.tip).slice(1)] : curve;
}

/** Tronco con raíces (modo árbol) o anillos de crecimiento (modo radial). Sólo decorativo. */
export const DecorNode = memo(function DecorNode({ data }: NodeProps<DecorFlowNode>) {
  const { w, h } = data;
  if (data.kind === 'rings') {
    return (
      <svg width={w} height={h} className="decor">
        {data.radii!.map((r, i) => (
          <circle key={i} cx={w / 2} cy={h / 2} r={r} className="ring" strokeWidth={i === data.radii!.length - 1 ? 2 : 1.4} />
        ))}
      </svg>
    );
  }
  const { trunk, limbs } = data.crown!;
  const bx = trunk.x;
  const wb = trunk.w;
  const stem = verticalCurve({ x: bx, y: trunk.baseY }, { x: bx, y: trunk.forkY });
  const roots = [-1, 1].flatMap((side) =>
    [0.55, 1].map((k) =>
      verticalCurve({ x: bx + side * wb * 0.2, y: trunk.baseY - 18 }, { x: bx + side * (wb * 0.9 + 110 * k), y: h - 4 }),
    ),
  );
  return (
    <svg width={w} height={h} className="decor">
      {data.leaves && (
        <g className="canopy">
          {data.leaves.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={data.leafR} />)}
        </g>
      )}
      <ellipse cx={bx} cy={h - 8} rx={wb * 2.6} ry={10} className="ground" />
      {roots.map((r, i) => <path key={`r${i}`} d={taper(r, wb * 0.42, 2)} className="trunk" />)}
      {limbs.map((l, i) => {
        const pts = limbPath(l);
        return (
          <g key={i}>
            <path d={taper(pts, l.w1, l.w2)} className="trunk" />
            {/* veta de luz a lo largo de la rama: le da volumen */}
            <path d={polyline(pts)} className="bark" strokeWidth={Math.max(1.5, ((l.w1 + l.w2) / 2) * 0.18)} transform={`translate(${-l.w2 * 0.15} 0)`} />
          </g>
        );
      })}
      <path d={taper(stem, wb, wb * 0.78)} className="trunk" />
      <path d={polyline(stem)} className="bark" strokeWidth={wb * 0.14} transform={`translate(${-wb * 0.18} 0)`} />
    </svg>
  );
});

export const nodeTypes = { person: PersonNode, union: UnionNode, decor: DecorNode };
