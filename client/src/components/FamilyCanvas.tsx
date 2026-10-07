import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type NodeChange,
  type OnConnectEnd,
} from '@xyflow/react';
import { Map as MapIcon, Unlink, X } from 'lucide-react';
import { useEditor } from '../store';
import { buildIndex, computeRelations, findPath } from '../lib/kinship';
import { buildFlow, computeFamilies, NODE_H, NODE_W, placeUnions, type FlowNode, type LinkEdge } from '../lib/graph';
import { computeGenerations } from '../lib/layout';
import { resolveTheme, themeVars } from '../lib/themes';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';

const PATTERN = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
} as const;

export function useDerived() {
  const persons = useEditor((s) => s.persons);
  const parentChild = useEditor((s) => s.parentChild);
  const partnerships = useEditor((s) => s.partnerships);
  const rootId = useEditor((s) => s.tree?.rootPersonId ?? null);
  const idx = useMemo(() => buildIndex(parentChild, partnerships), [parentChild, partnerships]);
  const relations = useMemo(() => computeRelations(rootId, persons, idx), [rootId, persons, idx]);
  return { idx, relations, rootId };
}

export function FamilyCanvas() {
  const s = useEditor();
  const rf = useReactFlow();
  const { idx, relations, rootId } = useDerived();
  const theme = resolveTheme(s.tree?.theme);

  const path = useMemo(() => {
    if (!rootId || !s.selectedId || s.exporting) return new Set<string>();
    return new Set(findPath(rootId, s.selectedId, idx));
  }, [rootId, s.selectedId, idx, s.exporting]);

  const mode = s.tree?.theme.layoutMode ?? 'generations';
  const families = useMemo(() => computeFamilies(s.parentChild, s.partnerships), [s.parentChild, s.partnerships]);
  const gen = useMemo(
    () => computeGenerations(Object.values(s.persons), s.parentChild, s.partnerships),
    // sólo cambia con la estructura, no con mover tarjetas
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(s.persons).join(), s.parentChild, s.partnerships],
  );
  const built = useMemo(
    () =>
      buildFlow({
        persons: s.persons,
        families,
        relations,
        gen,
        rootId,
        path,
        focus: s.focusMode,
        mode,
        edgeStyle: theme.edgeStyle,
        edgeColor: theme.edge,
        accent: theme.accent,
      }),
    [s.persons, families, relations, gen, rootId, path, s.focusMode, mode, theme.edgeStyle, theme.edge, theme.accent],
  );

  // Nodos locales (para arrastrar fluido); el store es la fuente de verdad y se sincroniza al soltar
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    const selChanged = lastSelected.current !== s.selectedId;
    lastSelected.current = s.selectedId;
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      return built.nodes.map((n) => {
        const p = prevMap.get(n.id);
        const selected = selChanged || !p ? n.id === s.selectedId : !!p.selected;
        return { ...n, measured: p?.measured, selected } as FlowNode;
      });
    });
  }, [built, s.selectedId]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((nds) => placeUnions(applyNodeChanges(changes, nds)));
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, __: FlowNode, dragged: FlowNode[]) => {
      s.savePositions(
        dragged.filter((n) => n.type === 'person').map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
      );
    },
    [s.savePositions],
  );

  // Conectar dos personas arrastrando entre sus puntos
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const side = (h?: string | null) => h === 'l' || h === 'r';
      // Asa "hacia los hijos": abajo normalmente, arriba en modo árbol (los hijos crecen hacia arriba)
      const [kids, parents] = mode === 'tree' ? ['t', 'b'] : ['b', 't'];
      if (c.sourceHandle === kids && c.targetHandle === parents) s.linkParent(c.source, c.target);
      else if (c.sourceHandle === parents && c.targetHandle === kids) s.linkParent(c.target, c.source);
      else if (side(c.sourceHandle) && side(c.targetHandle)) s.addPartnership(c.source, c.target);
      else s.set({ chooser: { a: c.source, b: c.target } });
    },
    [s, mode],
  );

  // Soltar una conexión en el vacío = crear un familiar nuevo justo ahí
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || state.fromNode.type !== 'person') return;
      const target = event.target as Element | null;
      if (!target?.classList.contains('react-flow__pane')) return;
      const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event;
      const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const h = state.fromHandle?.id;
      const kidsHandle = mode === 'tree' ? 't' : 'b';
      const kind = h === 'l' || h === 'r' ? 'partner' : h === kidsHandle ? 'child' : 'parent';
      s.createRelative(kind, state.fromNode.id, { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) });
    },
    [rf, s, mode],
  );

  // Encuadrar todo
  useEffect(() => {
    if (!s.fitRequest) return;
    // Se calcula con las posiciones del store (no depende de que React Flow ya haya medido los nodos)
    const t = setTimeout(() => {
      const ps = Object.values(useEditor.getState().persons);
      if (!ps.length) return;
      const xs = ps.map((p) => p.posX ?? 0);
      const ys = ps.map((p) => p.posY ?? 0);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      // En modo árbol se incluye el tronco que asoma debajo de la generación más antigua
      const extra = useEditor.getState().tree?.theme.layoutMode === 'tree' ? 300 : 20;
      rf.fitBounds(
        { x, y, width: Math.max(...xs) - x + NODE_W, height: Math.max(...ys) - y + NODE_H + extra },
        { padding: 0.12, duration: 500 },
      );
    }, 50);
    return () => clearTimeout(t);
    // sin `rf` en las dependencias: React Flow lo recrea al mover la vista y provocaría un bucle de movimientos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.fitRequest]);

  // En el celular la ficha ocupa la mitad de abajo: subir el lienzo para que la persona elegida quede a la vista
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    // Sólo cuando cambia la selección (no en cada render), si no la vista "se deslizaría" sola
    if (lastShown.current === s.selectedId) return;
    lastShown.current = s.selectedId;
    if (!s.selectedId || window.innerWidth > 820) return;
    const p = useEditor.getState().persons[s.selectedId];
    if (!p) return;
    const t = setTimeout(() => {
      const pane = document.querySelector('.canvas-wrap .react-flow')?.getBoundingClientRect();
      if (!pane) return;
      const { zoom } = rf.getViewport();
      // Centro horizontal y a ~22 % de la altura: la hoja inferior ocupa ~58 % de la pantalla
      const x = pane.width / 2 - ((p.posX ?? 0) + NODE_W / 2) * zoom;
      const y = pane.height * 0.22 - ((p.posY ?? 0) + NODE_H / 2) * zoom;
      rf.setViewport({ x, y, zoom }, { duration: 300 });
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selectedId]);

  // Centrar a una persona (búsqueda)
  useEffect(() => {
    const req = s.centerRequest;
    if (!req) return;
    const p = useEditor.getState().persons[req.id];
    if (p) rf.setCenter((p.posX ?? 0) + NODE_W / 2, (p.posY ?? 0) + NODE_H / 2, { zoom: 1.1, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.centerRequest]);

  // Línea seleccionada (clic en un vínculo) → se resalta y se puede quitar
  const selEdgeId = s.selectedEdge?.edgeId;
  const edges: LinkEdge[] = useMemo(
    () => (selEdgeId ? built.edges.map((e) => (e.id === selEdgeId ? { ...e, className: `${e.className} edge-sel` } : e)) : built.edges),
    [built.edges, selEdgeId],
  );

  const onEdgeClick = useCallback((_: unknown, e: LinkEdge) => {
    if (useEditor.getState().readOnly) return;
    const d = e.data;
    if (!d || (!d.pc?.length && !d.partnershipId)) return;
    useEditor.setState({ selectedId: null, selectedEdge: { edgeId: e.id, pc: d.pc ?? [], partnershipId: d.partnershipId, label: d.label ?? 'Vínculo' } });
  }, []);

  // Atajos: Ctrl+Z / Ctrl+Y deshacer-rehacer · Supr borra lo seleccionado · Esc deselecciona
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.modal-bg')) return;
      const st = useEditor.getState();
      if (ev.key === 'Escape') {
        st.select(null);
        st.openPanel(null);
        return;
      }
      if (st.readOnly) return;
      const mod = ev.ctrlKey || ev.metaKey;
      const k = ev.key.toLowerCase();
      if (mod && k === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) st.redo();
        else st.undo();
      } else if (mod && k === 'y') {
        ev.preventDefault();
        st.redo();
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (st.selectedEdge) {
          ev.preventDefault();
          st.deleteLinks(st.selectedEdge);
          return;
        }
        const ids = nodesRef.current.filter((n) => n.selected && n.type === 'person').map((n) => n.id);
        if (!ids.length && st.selectedId) ids.push(st.selectedId);
        if (ids.length) {
          ev.preventDefault();
          st.deletePersons(ids);
        }
      } else if (ev.key === 'Escape') {
        st.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`canvas-wrap mode-${mode} ${s.exporting ? 'exporting' : ''}`} style={{ ...themeVars(theme), background: theme.bg }}>
      <ReactFlow<FlowNode, LinkEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={() => useEditor.setState({ dragging: true })}
        onNodeDragStop={(e, n, ns) => {
          useEditor.setState({ dragging: false });
          onNodeDragStop(e, n, ns);
        }}
        onNodeClick={(_, n) => n.type === 'person' && s.select(n.id)}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => s.select(null)}
        onConnect={s.readOnly ? undefined : onConnect}
        onConnectEnd={s.readOnly ? undefined : onConnectEnd}
        nodesDraggable={!s.readOnly}
        nodesConnectable={!s.readOnly}
        isValidConnection={(c) => c.source !== c.target && !c.source.includes(':') && !c.target.includes(':')}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        deleteKeyCode={null}
        minZoom={0.05}
        maxZoom={3}
        snapToGrid={s.snap}
        snapGrid={[20, 20]}
        proOptions={{ hideAttribution: true }}
        nodeDragThreshold={3}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Control', 'Meta']}
      >
        {theme.pattern !== 'none' && (
          <Background variant={PATTERN[theme.pattern]} color={theme.patternColor} gap={theme.pattern === 'dots' ? 22 : 44} size={theme.pattern === 'dots' ? 1.6 : 1} />
        )}
        <Controls showInteractive={false} position="bottom-left">
          <ControlButton onClick={() => s.set({ showMinimap: !s.showMinimap })} title={s.showMinimap ? 'Ocultar minimapa' : 'Mostrar minimapa'}>
            <MapIcon size={14} />
          </ControlButton>
        </Controls>
        {s.showMinimap && <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => (n.type !== 'person' ? 'transparent' : n.id === s.selectedId ? theme.accent : theme.edge)}
          nodeBorderRadius={8}
          maskColor="rgba(0,0,0,0.08)"
          style={{ background: theme.cardBg }}
        />}
      </ReactFlow>
      {s.selectedEdge && (
        <div className="edge-bar">
          <span>{s.selectedEdge.label}</span>
          <button className="btn sm danger" onClick={() => s.deleteLinks(s.selectedEdge!)}>
            <Unlink size={14} /> Quitar vínculo
          </button>
          <button className="icon-btn" onClick={() => s.set({ selectedEdge: null })} title="Cerrar">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
