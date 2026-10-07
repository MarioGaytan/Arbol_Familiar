import { memo } from 'react';
import { useInternalNode, type EdgeProps, type InternalNode, type Node } from '@xyflow/react';
import type { LinkEdge } from '../lib/graph';
import { line, polyline, radialCurve, taper, verticalCurve, type Pt } from '../lib/branch';

const centerOf = (n: InternalNode<Node>): Pt => ({
  x: n.internals.positionAbsolute.x + (n.measured?.width ?? n.width ?? 0) / 2,
  y: n.internals.positionAbsolute.y + (n.measured?.height ?? n.height ?? 0) / 2,
});

/** Línea con forma de rama: se afina hacia las generaciones nuevas. */
export const BranchEdge = memo(function BranchEdge({ source, target, sourceX, sourceY, targetX, targetY, data }: EdgeProps<LinkEdge>) {
  const sn = useInternalNode(source);
  const tn = useInternalNode(target);
  let s: Pt = { x: sourceX, y: sourceY };
  let t: Pt = { x: targetX, y: targetY };
  if (data?.floating && sn && tn) {
    s = centerOf(sn);
    t = centerOf(tn);
  }
  const pts = data?.shape === 'radial' ? radialCurve(s, t) : data?.shape === 'straight' ? line(s, t) : verticalCurve(s, t);
  const w1 = data?.w1 ?? 4;
  const w2 = data?.w2 ?? 3;
  const center = polyline(pts);
  return (
    <>
      <path d={center} fill="none" stroke="transparent" strokeWidth={20} className="react-flow__edge-interaction" />
      {data?.dashed ? (
        <path d={center} className="branch-line" strokeWidth={(w1 + w2) / 2} strokeDasharray="9 8" />
      ) : (
        <path d={taper(pts, w1, w2)} className="branch-fill" />
      )}
    </>
  );
});

export const edgeTypes = { branch: BranchEdge };
