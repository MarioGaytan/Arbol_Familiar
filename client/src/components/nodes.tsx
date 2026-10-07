import { memo, useState, type CSSProperties, type DragEvent } from 'react';
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import { Baby, Heart, Star, UserPlus, Users } from 'lucide-react';
import { NODE_H, type DecorFlowNode, type PersonFlowNode, type UnionFlowNode } from '../lib/graph';
import { taper, verticalCurve } from '../lib/branch';
import { ageText, initials } from '../lib/format';
import { useEditor } from '../store';

export const PersonNode = memo(function PersonNode({ id, data, selected }: NodeProps<PersonFlowNode>) {
  const { person, relation, isRoot, highlight, dim } = data;
  const createRelative = useEditor((s) => s.createRelative);
  const setStore = useEditor((s) => s.set);
  const exporting = useEditor((s) => s.exporting);
  const readOnly = useEditor((s) => s.readOnly);
  const showDates = useEditor((s) => s.tree?.theme.showDates ?? true);
  const showRelations = useEditor((s) => s.tree?.theme.showRelations ?? true);
  const [dropping, setDropping] = useState(false);

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
      <NodeToolbar isVisible={selected && !exporting && !readOnly} position={Position.Bottom} offset={14}>
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
            <img src={person.photoUrl} alt="" draggable={false} />
          ) : (
            <span>{initials(person)}</span>
          )}
        </div>
        <div className="p-text">
          <div className="p-name" title={[person.firstName, person.lastName].filter(Boolean).join(' ')}>
            {person.firstName}
          </div>
          <div className="p-last">{person.lastName || '\u00a0'}</div>
          {showDates && (born || died) && (
            <div className="p-dates">
              {born ? (died ? `${born} – ${died}` : `n. ${born}`) : `† ${died}`}
              {ageLabel && <span className="p-age">{died ? ` · ${ageLabel}` : ` · ${ageLabel}`}</span>}
            </div>
          )}
        </div>
        {showRelations && relation && <div className={`p-rel ${isRoot ? 'root' : ''}`}>{relation}</div>}
      </div>
    </>
  );
});

export const UnionNode = memo(function UnionNode({ data }: NodeProps<UnionFlowNode>) {
  const up = data.mode === 'tree';
  return (
    <div
      className={`union ${data.mode === 'radial' ? 'dot' : ''} ${data.hl ? 'hl' : ''} ${data.dim ? 'dim' : ''}`}
      style={data.mode === 'radial' ? undefined : { width: data.w, borderRadius: data.w }}
    >
      <Handle type="target" position={up ? Position.Bottom : Position.Top} id="in" isConnectable={false} className="union-h" />
      <Handle type="source" position={up ? Position.Top : Position.Bottom} id="out" isConnectable={false} className="union-h" />
    </div>
  );
});

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
  const anchors = data.anchors!;
  const bx = anchors.reduce((s, a) => s + a.x, 0) / anchors.length;
  const baseY = h - 34;
  const forkY = Math.max(NODE_H / 2 + 60, h * 0.5);
  const wb = Math.min(96, 46 + anchors.length * 12);
  const trunk = verticalCurve({ x: bx, y: baseY }, { x: bx, y: forkY });
  const roots = [-1, 1].flatMap((side) =>
    [0.55, 1].map((k) => verticalCurve({ x: bx + side * wb * 0.2, y: baseY - 18 }, { x: bx + side * (70 + 90 * k), y: h - 4 })),
  );
  return (
    <svg width={w} height={h} className="decor">
      <ellipse cx={bx} cy={h - 8} rx={wb * 2.6} ry={10} className="ground" />
      {roots.map((r, i) => <path key={`r${i}`} d={taper(r, wb * 0.42, 2)} className="trunk" />)}
      <path d={taper(trunk, wb, wb * 0.72)} className="trunk" />
      {anchors.map((a, i) => (
        <path key={i} d={taper(verticalCurve({ x: bx, y: forkY + 6 }, { x: a.x, y: a.y }), (wb * 0.72) / Math.sqrt(anchors.length), a.w)} className="trunk" />
      ))}
    </svg>
  );
});

export const nodeTypes = { person: PersonNode, union: UnionNode, decor: DecorNode };
