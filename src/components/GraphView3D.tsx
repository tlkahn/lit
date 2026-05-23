import { Canvas } from "@react-three/fiber";
import type { GraphNode } from "../lib/ipc";

export interface GraphView3DProps {
  nodes: GraphNode[];
  edges: [string, string][];
  positions: Record<string, { x: number; y: number; z: number }>;
  pagerank: Record<string, number>;
  seedId?: string;
  onNavigate?: (pageId: string) => void;
  onHover?: (info: { visible: boolean; x: number; y: number; title: string; connections: number }) => void;
  onContextMenu?: (info: { nodeId: string; x: number; y: number }) => void;
  onResetZoom?: React.RefObject<{ resetCamera: () => void; flyTo: (pos: { x: number; y: number; z: number }) => void } | null>;
}

export function GraphView3D(_props: GraphView3DProps) {
  return (
    <div data-testid="graph-view-3d" style={{ position: "absolute", inset: 0 }}>
      <Canvas>
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="orange" />
        </mesh>
      </Canvas>
    </div>
  );
}
