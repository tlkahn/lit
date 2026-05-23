import { useMemo, useRef, useEffect } from "react";
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from "three";
import { buildEdgePositions } from "../lib/graph3DHelpers";

export interface GraphEdges3DProps {
  edges: [string, string][];
  positions: Record<string, { x: number; y: number; z: number }>;
  edgeColor: string;
  opacity: number;
}

export function GraphEdges3D({ edges, positions, edgeColor, opacity }: GraphEdges3DProps) {
  const geomRef = useRef<BufferGeometry>(null);
  const matRef = useRef<LineBasicMaterial>(null);

  const positionArray = useMemo(
    () => buildEdgePositions(edges, positions),
    [edges, positions],
  );

  useEffect(() => {
    if (!geomRef.current || typeof geomRef.current.computeBoundingSphere !== "function") return;
    geomRef.current.setAttribute("position", new Float32BufferAttribute(positionArray, 3));
    geomRef.current.computeBoundingSphere();
  }, [positionArray]);

  useEffect(() => {
    if (!matRef.current || !matRef.current.color) return;
    matRef.current.color.set(edgeColor);
    matRef.current.opacity = opacity;
    matRef.current.needsUpdate = true;
  }, [edgeColor, opacity]);

  return (
    <lineSegments>
      <bufferGeometry ref={geomRef} />
      <lineBasicMaterial ref={matRef} transparent opacity={opacity} color={edgeColor} />
    </lineSegments>
  );
}
