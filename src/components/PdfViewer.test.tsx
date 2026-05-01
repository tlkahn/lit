import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PdfViewer } from "./PdfViewer";
import { mockInvoke } from "../test/tauri-mock";

const mockPdfInfo = { page_count: 3, path: "/test/doc.pdf" };
const mockRenderedPage = {
  page_index: 0,
  png_base64: "iVBORw0KGgoAAAANSUhEUg==",
  width: 1224,
  height: 1584,
};

beforeEach(() => {
  Object.defineProperty(window, "devicePixelRatio", {
    writable: true,
    value: 1,
  });
  mockInvoke((cmd, args) => {
    switch (cmd) {
      case "pdf_open":
        return mockPdfInfo;
      case "pdf_render_page": {
        const a = args as Record<string, unknown>;
        return { ...mockRenderedPage, page_index: a?.pageIndex ?? 0 };
      }
      case "pdf_close":
        return null;
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  });
});

describe("PdfViewer", () => {
  it("renders an img with base64 png src", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.src).toContain("data:image/png;base64,");
      expect(img.src).toContain(mockRenderedPage.png_base64);
    });
  });

  it("shows page indicator", async () => {
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      const indicator = screen.getByTestId("pdf-page-indicator");
      expect(indicator.textContent).toBe("Page 1 / 3");
    });
  });

  it("next button navigates to page 2", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 1 / 3");
    });

    await user.click(screen.getByTestId("pdf-next"));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 2 / 3");
    });
  });

  it("prev disabled on page 1, next disabled on last page", async () => {
    const user = userEvent.setup();
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator")).toBeInTheDocument();
    });

    expect(screen.getByTestId("pdf-prev")).toBeDisabled();
    expect(screen.getByTestId("pdf-next")).not.toBeDisabled();

    // Navigate to last page
    await user.click(screen.getByTestId("pdf-next"));
    await user.click(screen.getByTestId("pdf-next"));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-indicator").textContent).toBe("Page 3 / 3");
    });

    expect(screen.getByTestId("pdf-next")).toBeDisabled();
    expect(screen.getByTestId("pdf-prev")).not.toBeDisabled();
  });

  it("calls pdfOpen on mount and pdfClose on unmount", async () => {
    const { unmount } = render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_open", { path: "/test/doc.pdf" });

    unmount();

    expect(invoke).toHaveBeenCalledWith("pdf_close");
  });

  it("shows loading state initially", () => {
    render(<PdfViewer filePath="/test/doc.pdf" />);
    expect(screen.getByTestId("pdf-loading")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    mockInvoke((cmd) => {
      if (cmd === "pdf_open") throw new Error("Failed to open PDF");
      if (cmd === "pdf_close") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<PdfViewer filePath="/bad/doc.pdf" />);

    await waitFor(() => {
      const error = screen.getByTestId("pdf-error");
      expect(error).toBeInTheDocument();
      expect(error.textContent).toContain("Failed to open PDF");
    });
  });

  it("passes DPI = 144 × devicePixelRatio to pdfRenderPage", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-image")).toBeInTheDocument();
    });

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("pdf_render_page", {
      pageIndex: 0,
      dpi: 288,
    });
  });

  it("sets CSS width to rendered.width / devicePixelRatio", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    render(<PdfViewer filePath="/test/doc.pdf" />);

    await waitFor(() => {
      const img = screen.getByTestId("pdf-page-image") as HTMLImageElement;
      expect(img.style.width).toBe("612px");
    });
  });
});
