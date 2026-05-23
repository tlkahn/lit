import { useMemo, useRef, useEffect } from "react";
import { InstancedMesh, InstancedBufferAttribute } from "three";
import { buildInstanceMatrices, buildInstanceColors } from "../lib/graph3DHelpers";
import type { GraphNode } from "../lib/ipc";

export interface GraphNodes3DProps {
  nodes: GraphNode[];
  positions: Record<string, { x: number; y: number; z: number }>;
  pagerank: Record<string, number>;
  accentColor: string;
  stubColor: string;
  seedId?: string;
  sphereSegments: [number, number];
  meshRef?: React.RefObject<InstancedMesh | null>;
}

export function GraphNodes3D({
  nodes,
  positions,
  pagerank,
  accentColor,
  stubColor,
  seedId,
  sphereSegments,
  meshRef: externalMeshRef,
}: GraphNodes3DProps) {
  const internalRef = useRef<InstancedMesh>(null);
  const meshRef = externalMeshRef ?? internalRef;

  const matrices = useMemo(
    () => buildInstanceMatrices(nodes, positions, pagerank),
    [nodes, positions, pagerank],
  );

  const colors = useMemo(
    () => buildInstanceColors(nodes, accentColor, stubColor, seedId),
    [nodes, accentColor, stubColor, seedId],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || nodes.length === 0 || !mesh.instanceMatrix) return;

    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;

    mesh.instanceColor = new InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.needsUpdate = true;
  }, [matrices, colors, nodes.length]);

  if (nodes.length === 0) return null;

  return (
    <instancedMesh ref={meshRef as React.RefObject<InstancedMesh>} args={[undefined, undefined, nodes.length]}>
      <sphereGeometry args={[1, sphereSegments[0], sphereSegments[1]]} />
      <meshStandardMaterial vertexColors />
    </instancedMesh>
  );
}
