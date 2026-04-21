import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ContentErrorFallback } from "./ContentErrorFallback";

describe("ContentErrorFallback", () => {
  it("renders reassurance message", () => {
    render(
      <ContentErrorFallback
        error={new Error("test")}
        resetErrorBoundary={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Something went wrong in the editor"),
    ).toBeInTheDocument();
    expect(screen.getByText(/files are safe/)).toBeInTheDocument();
  });

  it("shows error message in details", () => {
    render(
      <ContentErrorFallback
        error={new Error("kaboom")}
        resetErrorBoundary={vi.fn()}
      />,
    );
    act(() => {
      screen.getByText("Show details").click();
    });
    expect(screen.getByText("kaboom")).toBeInTheDocument();
  });

  it("Try Again button calls resetErrorBoundary", () => {
    const reset = vi.fn();
    render(
      <ContentErrorFallback error={new Error("test")} resetErrorBoundary={reset} />,
    );
    act(() => {
      screen.getByText("Try Again").click();
    });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
