import { useCallback, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import type { GraphNode } from "../lib/ipc";
import { resolveThemeColors } from "../lib/graphLayout";
import { get3DQualitySettings } from "../lib/qualityTiers3D";
import { useThemeStore } from "../stores/theme";
import { CameraController } from "./CameraController";
import type { CameraControllerHandle } from "./CameraController";
import { SceneLighting } from "./SceneLighting";
import { GraphNodes3D } from "./GraphNodes3D";
import { GraphEdges3D } from "./GraphEdges3D";

export interface GraphView3DProps {
  nodes: GraphNode[];
  edges: [string, string][];
  positions: Record<string, { x: number; y: number; z: number }>;
  pagerank: Record<string, number>;
  seedId?: string;
  onNavigate?: (pageId: string) => void;
  onHover?: (info: { visible: boolean; x: number; y: number; title: string; connections: number }) => void;
  onContextMenu?: (info: { nodeId: string; x: number; y: number }) => void;
  onResetZoom?: React.RefObject<CameraControllerHandle | null>;
}

export function GraphView3D({
  nodes,
  edges,
  positions,
  pagerank,
  seedId,
  // Phase 3: onNavigate, onHover, onContextMenu (raycasting interaction)
  onResetZoom,
}: GraphView3DProps) {
  const cameraCallbackRef = useCallback(
    (handle: CameraControllerHandle | null) => {
      if (onResetZoom) {
        (onResetZoom as React.MutableRefObject<CameraControllerHandle | null>).current = handle;
      }
    },
    [onResetZoom],
  );

  const activeThemeId = useThemeStore((s) => s.activeThemeId);

  const colors = useMemo(() => resolveThemeColors(), [activeThemeId]);
  const tierSettings = useMemo(() => get3DQualitySettings(nodes.length), [nodes.length]);

  const isDark = useMemo(() => {
    if (typeof document === "undefined") return false;
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--background-primary")
      .trim();
    if (!bg) return false;
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    return (r + g + b) / 3 < 128;
  }, [activeThemeId]);

  return (
    <div data-testid="graph-view-3d" style={{ position: "absolute", inset: 0 }}>
      <Canvas>
        <CameraController positions={positions} ref={cameraCallbackRef} />
        <SceneLighting isDark={isDark} />
        <GraphNodes3D
          nodes={nodes}
          positions={positions}
          pagerank={pagerank}
          accentColor={colors.accentColor}
          stubColor={colors.stubColor}
          seedId={seedId}
          sphereSegments={[tierSettings.sphereWidthSegments, tierSettings.sphereHeightSegments]}
        />
        <GraphEdges3D
          edges={edges}
          positions={positions}
          edgeColor={colors.edgeColor}
          opacity={tierSettings.edgeOpacity}
        />
      </Canvas>
    </div>
  );
}
