import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { SceneLighting } from "./SceneLighting";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));

describe("SceneLighting", () => {
  it("renders without crash in light mode", () => {
    const { container } = render(<SceneLighting isDark={false} />);
    expect(container).toBeTruthy();
  });

  it("renders without crash in dark mode", () => {
    const { container } = render(<SceneLighting isDark={true} />);
    expect(container).toBeTruthy();
  });
});
