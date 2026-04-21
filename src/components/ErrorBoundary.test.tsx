import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ErrorBoundary, type FallbackProps } from "./ErrorBoundary";

function Fallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div data-testid="fallback">
      <span data-testid="error-message">{error.message}</span>
      <button onClick={resetErrorBoundary}>Reset</button>
    </div>
  );
}

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("test error");
  return <div data-testid="child">OK</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary fallback={Fallback}>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("Hello");
  });

  it("catches render errors and shows fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={Fallback}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(screen.getByTestId("error-message")).toHaveTextContent("test error");
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("resetErrorBoundary re-renders children", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;

    function Child() {
      if (shouldThrow) throw new Error("boom");
      return <div data-testid="child">Recovered</div>;
    }

    render(
      <ErrorBoundary fallback={Fallback}>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();

    shouldThrow = false;
    act(() => {
      screen.getByText("Reset").click();
    });
    expect(screen.getByTestId("child")).toHaveTextContent("Recovered");
    vi.restoreAllMocks();
  });

  it("resetKey change auto-clears error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;

    function Child() {
      if (shouldThrow) throw new Error("boom");
      return <div data-testid="child">OK</div>;
    }

    const { rerender } = render(
      <ErrorBoundary fallback={Fallback} resetKey="page-a">
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();

    shouldThrow = false;
    rerender(
      <ErrorBoundary fallback={Fallback} resetKey="page-b">
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("OK");
    vi.restoreAllMocks();
  });

  it("calls onError callback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();

    render(
      <ErrorBoundary fallback={Fallback} onError={onError}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]![0].message).toBe("test error");
    vi.restoreAllMocks();
  });
});
