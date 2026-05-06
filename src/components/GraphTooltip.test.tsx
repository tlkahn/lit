import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphTooltip } from "./GraphTooltip";

describe("GraphTooltip", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(
      <GraphTooltip visible={false} x={0} y={0} title="" inbound={0} outbound={0} />,
    );
    expect(container.querySelector(".graph-tooltip")).toBeNull();
  });

  it("shows title when visible", () => {
    render(
      <GraphTooltip visible={true} x={100} y={200} title="My Page" inbound={3} outbound={5} />,
    );
    expect(screen.getByText("My Page")).toBeTruthy();
  });

  it("shows inbound and outbound link counts", () => {
    render(
      <GraphTooltip visible={true} x={0} y={0} title="X" inbound={3} outbound={5} />,
    );
    expect(screen.getByText(/3 in/)).toBeTruthy();
    expect(screen.getByText(/5 out/)).toBeTruthy();
  });

  it("is positioned at given x,y coordinates", () => {
    const { container } = render(
      <GraphTooltip visible={true} x={150} y={250} title="X" inbound={0} outbound={0} />,
    );
    const tooltip = container.querySelector(".graph-tooltip") as HTMLElement;
    expect(tooltip.style.left).toBe("150px");
    expect(tooltip.style.top).toBe("250px");
  });
});
