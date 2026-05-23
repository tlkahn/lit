import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { CameraController } from "./CameraController";
import type { CameraControllerHandle } from "./CameraController";

const mockCamera = {
  position: { set: vi.fn(), x: 0, y: 0, z: 0 },
  lookAt: vi.fn(),
  fov: 75,
};

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useThree: () => ({ camera: mockCamera }),
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
}));

describe("CameraController", () => {
  it("renders without crash", () => {
    const { container } = render(<CameraController positions={{}} />);
    expect(container).toBeTruthy();
  });

  it("accepts ref without error", () => {
    const ref = createRef<CameraControllerHandle>();
    const { container } = render(<CameraController ref={ref} positions={{}} />);
    expect(container).toBeTruthy();
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current!.resetCamera).toBe("function");
    expect(typeof ref.current!.flyTo).toBe("function");
  });

  it("resetCamera via ref resets camera position", () => {
    const ref = createRef<CameraControllerHandle>();
    render(
      <CameraController
        ref={ref}
        positions={{ a: { x: 5, y: 5, z: 5 } }}
      />,
    );
    mockCamera.position.set.mockClear();
    mockCamera.lookAt.mockClear();
    ref.current!.resetCamera();
    expect(mockCamera.position.set).toHaveBeenCalled();
    expect(mockCamera.lookAt).toHaveBeenCalled();
  });

  it("sets camera position on mount with positions", () => {
    render(
      <CameraController
        positions={{ a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 0, z: 0 } }}
      />,
    );
    expect(mockCamera.position.set).toHaveBeenCalled();
    expect(mockCamera.lookAt).toHaveBeenCalled();
  });
});
