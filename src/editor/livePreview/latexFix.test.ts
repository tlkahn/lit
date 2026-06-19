import { describe, it, expect, vi, beforeEach } from "vitest";

const mockKatex = {
  renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`),
};

vi.mock("./katexLoader", () => ({
  getKatexSync: vi.fn(() => mockKatex),
}));

import { getKatexSync } from "./katexLoader";
import { isUnparsableLatex, stripLatexResponse, LATEX_FIX_SYSTEM_PROMPT, buildLatexFixArgs } from "./latexFix";
import type { LatexFixTarget } from "./latexFix";
import { usePreferencesStore } from "../../stores/preferences";

describe("isUnparsableLatex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKatex.renderToString.mockImplementation(
      (tex: string) => `<span class="katex">${tex}</span>`,
    );
  });

  it("returns false for valid LaTeX", () => {
    expect(isUnparsableLatex("x^2")).toBe(false);
  });

  it("returns true for broken LaTeX", () => {
    mockKatex.renderToString.mockImplementation(() => {
      throw new Error("KaTeX parse error");
    });
    expect(isUnparsableLatex("\\frac{")).toBe(true);
  });

  it("returns false for empty or whitespace-only strings without calling KaTeX", () => {
    expect(isUnparsableLatex("")).toBe(false);
    expect(isUnparsableLatex("   \t\n  ")).toBe(false);
    expect(mockKatex.renderToString).not.toHaveBeenCalled();
  });

  it("returns false when KaTeX is not loaded", () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    expect(isUnparsableLatex("x^2")).toBe(false);
    expect(mockKatex.renderToString).not.toHaveBeenCalled();
  });

  it("calls renderToString with throwOnError: true", () => {
    isUnparsableLatex("x^2");
    expect(mockKatex.renderToString).toHaveBeenCalledWith("x^2", { throwOnError: true });
  });
});

describe("stripLatexResponse", () => {
  it("passes through plain LaTeX unchanged", () => {
    expect(stripLatexResponse("\\frac{1}{2}")).toBe("\\frac{1}{2}");
  });

  it("strips ```latex fence", () => {
    expect(stripLatexResponse("```latex\n\\frac{1}{2}\n```")).toBe("\\frac{1}{2}");
  });

  it("strips bare ``` fence without language tag", () => {
    expect(stripLatexResponse("```\n\\frac{1}{2}\n```")).toBe("\\frac{1}{2}");
  });

  it("strips $...$ delimiters", () => {
    expect(stripLatexResponse("$\\frac{1}{2}$")).toBe("\\frac{1}{2}");
  });

  it("strips $$...$$ delimiters", () => {
    expect(stripLatexResponse("$$\\frac{1}{2}$$")).toBe("\\frac{1}{2}");
  });

  it("strips combined fence + $$ delimiters", () => {
    expect(stripLatexResponse("```latex\n$$\\frac{1}{2}$$\n```")).toBe("\\frac{1}{2}");
  });

  it("handles surrounding whitespace", () => {
    expect(stripLatexResponse("  \\frac{1}{2}  ")).toBe("\\frac{1}{2}");
  });

  it("returns empty string for empty input", () => {
    expect(stripLatexResponse("")).toBe("");
  });
});

describe("LATEX_FIX_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof LATEX_FIX_SYSTEM_PROMPT).toBe("string");
    expect(LATEX_FIX_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});

describe("buildLatexFixArgs", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      llmProvider: {
        providerId: "anthropic",
        model: "claude-sonnet-4-6",
        apiKeySet: true,
      },
      llmCustomProviders: [],
    });
  });

  it("returns correct args for a standard provider", () => {
    const args = buildLatexFixArgs("\\frac{");
    expect(args.provider).toBe("anthropic");
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.text).toBe("\\frac{");
    expect(args.system).toBe(LATEX_FIX_SYSTEM_PROMPT);
    expect(args.baseUrl).toBeUndefined();
    expect(args.contextWindow).toBeUndefined();
  });

  it("returns baseUrl and contextWindow for custom provider", () => {
    usePreferencesStore.setState({
      llmProvider: {
        providerId: "custom-vllm",
        model: "my-model",
        apiKeySet: false,
      },
      llmCustomProviders: [
        {
          id: "custom-vllm",
          name: "vLLM",
          baseUrl: "http://localhost:8000/v1",
          needsApiKey: false,
          modelId: "my-model",
          contextWindow: 4096,
        },
      ],
    });
    const args = buildLatexFixArgs("\\frac{");
    expect(args.provider).toBe("custom-vllm");
    expect(args.baseUrl).toBe("http://localhost:8000/v1");
    expect(args.contextWindow).toBe(4096);
  });

  it("prefers llmProvider.baseUrl over customDef.baseUrl", () => {
    usePreferencesStore.setState({
      llmProvider: {
        providerId: "custom-vllm",
        model: "my-model",
        baseUrl: "http://manual-override:9000/v1",
        apiKeySet: false,
      },
      llmCustomProviders: [
        {
          id: "custom-vllm",
          name: "vLLM",
          baseUrl: "http://localhost:8000/v1",
          needsApiKey: false,
          modelId: "my-model",
          contextWindow: 4096,
        },
      ],
    });
    const args = buildLatexFixArgs("\\frac{");
    expect(args.baseUrl).toBe("http://manual-override:9000/v1");
  });

  it("returns undefined baseUrl/contextWindow when custom provider def is missing", () => {
    usePreferencesStore.setState({
      llmProvider: {
        providerId: "custom-missing",
        model: "some-model",
        apiKeySet: false,
      },
      llmCustomProviders: [],
    });
    const args = buildLatexFixArgs("\\frac{");
    expect(args.baseUrl).toBeUndefined();
    expect(args.contextWindow).toBeUndefined();
  });

  it("always sets system prompt", () => {
    const args = buildLatexFixArgs("x");
    expect(args.system).toBe(LATEX_FIX_SYSTEM_PROMPT);
  });
});

describe("LatexFixTarget", () => {
  it("has the expected shape", () => {
    const target: LatexFixTarget = {
      brokenLatex: "\\frac{",
      from: 10,
      to: 16,
    };
    expect(target.brokenLatex).toBe("\\frac{");
    expect(target.from).toBe(10);
    expect(target.to).toBe(16);
  });
});
