import { forwardRef, useImperativeHandle, useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { computeBoundingSphere, computeCameraDistance } from "../lib/graph3DHelpers";

export interface CameraControllerHandle {
  resetCamera: () => void;
  flyTo: (pos: { x: number; y: number; z: number }) => void;
}

export interface CameraControllerProps {
  positions: Record<string, { x: number; y: number; z: number }>;
}

export const CameraController = forwardRef<CameraControllerHandle, CameraControllerProps>(
  function CameraController({ positions }, ref) {
    const { camera } = useThree();
    const controlsRef = useRef<import("three-stdlib").OrbitControls>(null);

    const fitCamera = () => {
      const { center, radius } = computeBoundingSphere(positions);
      const fov = (camera as { fov?: number }).fov ?? 75;
      const dist = computeCameraDistance(radius, fov);

      camera.position.set(center.x, center.y + dist * 0.3, center.z + dist);
      camera.lookAt(center.x, center.y, center.z);

      if (controlsRef.current) {
        controlsRef.current.target.set(center.x, center.y, center.z);
        controlsRef.current.update();
      }
    };

    useEffect(() => {
      fitCamera();
    }, [positions]);

    useImperativeHandle(ref, () => ({
      resetCamera: () => fitCamera(),
      flyTo: (pos) => {
        camera.position.set(pos.x, pos.y + 5, pos.z + 10);
        camera.lookAt(pos.x, pos.y, pos.z);
        if (controlsRef.current) {
          controlsRef.current.target.set(pos.x, pos.y, pos.z);
          controlsRef.current.update();
        }
      },
    }));

    return (
      <OrbitControls ref={controlsRef} enableDamping dampingFactor={0.1} />
    );
  },
);
