import { useRef, useEffect, useCallback, useMemo } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { Raycaster, InstancedMesh, InstancedBufferAttribute } from "three";
import type { GraphNode } from "../lib/ipc";
import {
  buildNeighborSet,
  buildHighlightColors,
  buildInstanceColors,
  projectToScreen,
} from "../lib/graph3DHelpers";

export interface GraphInteraction3DProps {
  meshRef: React.RefObject<InstancedMesh | null>;
  nodes: GraphNode[];
  edges: [string, string][];
  positions: Record<string, { x: number; y: number; z: number }>;
  accentColor: string;
  stubColor: string;
  dimColor: string;
  seedId?: string;
  raycastStrategy: "per-frame" | "throttled";
  raycastThrottleMs: number;
  onNavigate?: (pageId: string) => void;
  onHover?: (info: { visible: boolean; x: number; y: number; title: string; connections: number }) => void;
  onContextMenu?: (info: { nodeId: string; x: number; y: number }) => void;
}

export function GraphInteraction3D({
  meshRef,
  nodes,
  edges,
  positions,
  accentColor,
  stubColor,
  dimColor,
  seedId,
  raycastStrategy,
  raycastThrottleMs,
  onNavigate,
  onHover,
  onContextMenu,
}: GraphInteraction3DProps) {
  const { camera, gl, pointer, size } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);
  const hoveredRef = useRef<number | null>(null);
  const lastRaycastTime = useRef(0);
  const downInstanceRef = useRef<number | null>(null);

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;

  const baseColors = useMemo(
    () => buildInstanceColors(nodes, accentColor, stubColor, seedId),
    [nodes, accentColor, stubColor, seedId],
  );

  const setHighlight = useCallback(
    (instanceId: number) => {
      const mesh = meshRef.current;
      if (!mesh || nodes.length === 0) return;
      const node = nodes[instanceId];
      if (!node) return;

      const neighbors = buildNeighborSet(edges, node.id);
      const colors = buildHighlightColors(nodes, node.id, neighbors, accentColor, stubColor, dimColor, seedId);
      mesh.instanceColor = new InstancedBufferAttribute(colors, 3);
      mesh.instanceColor.needsUpdate = true;
    },
    [meshRef, nodes, edges, accentColor, stubColor, dimColor, seedId],
  );

  const clearHighlight = useCallback(() => {
    const mesh = meshRef.current;
    if (!mesh || nodes.length === 0) return;
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(baseColors), 3);
    mesh.instanceColor.needsUpdate = true;
  }, [meshRef, nodes.length, baseColors]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (raycastStrategy === "throttled") {
      const now = performance.now();
      if (now - lastRaycastTime.current < raycastThrottleMs) return;
      lastRaycastTime.current = now;
    }

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(mesh);

    if (hits.length > 0 && hits[0]!.instanceId != null) {
      const instanceId = hits[0]!.instanceId!;
      if (hoveredRef.current !== instanceId) {
        hoveredRef.current = instanceId;
        setHighlight(instanceId);

        const node = nodes[instanceId];
        if (node && onHoverRef.current) {
          const pos = positions[node.id];
          if (pos) {
            const screen = projectToScreen(pos, camera as never, size);
            const neighbors = buildNeighborSet(edges, node.id);
            onHoverRef.current({
              visible: true,
              x: screen.x,
              y: screen.y,
              title: node.title,
              connections: neighbors.size,
            });
          }
        }
      }
    } else if (hoveredRef.current !== null) {
      hoveredRef.current = null;
      clearHighlight();
      if (onHoverRef.current) {
        onHoverRef.current({ visible: false, x: 0, y: 0, title: "", connections: 0 });
      }
    }
  });

  useEffect(() => {
    const el = gl.domElement;

    const onPointerDown = () => {
      downInstanceRef.current = hoveredRef.current;
    };

    const onPointerUp = () => {
      if (
        downInstanceRef.current !== null &&
        downInstanceRef.current === hoveredRef.current
      ) {
        const node = nodes[downInstanceRef.current];
        if (node && onNavigateRef.current) {
          onNavigateRef.current(node.id);
        }
      }
      downInstanceRef.current = null;
    };

    const onCtxMenu = (e: Event) => {
      if (hoveredRef.current !== null) {
        const node = nodes[hoveredRef.current];
        const me = e as MouseEvent;
        if (node && onContextMenuRef.current) {
          e.preventDefault();
          onContextMenuRef.current({
            nodeId: node.id,
            x: me.clientX,
            y: me.clientY,
          });
        }
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("contextmenu", onCtxMenu);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("contextmenu", onCtxMenu);
    };
  }, [gl, nodes]);

  return null;
}
