import { describe, it, expect, vi, beforeEach } from "vitest";

const mockKatex = {
  renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`),
};

vi.mock("./katexLoader", () => ({
  getKatexSync: vi.fn(() => mockKatex),
}));

import { getKatexSync } from "./katexLoader";
import { isUnparsableLatex, stripLatexResponse, LATEX_FIX_SYSTEM_PROMPT, buildLatexFixArgs } from "./latexFix";
import type { LatexFixTarget, LatexCheckResult } from "./latexFix";
import { usePreferencesStore } from "../../stores/preferences";

describe("isUnparsableLatex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKatex.renderToString.mockImplementation(
      (tex: string) => `<span class="katex">${tex}</span>`,
    );
  });

  it("returns 'valid' for valid LaTeX", () => {
    expect(isUnparsableLatex("x^2")).toBe("valid");
  });

  it("returns 'unparsable' for broken LaTeX", () => {
    mockKatex.renderToString.mockImplementation(() => {
      throw new Error("KaTeX parse error");
    });
    expect(isUnparsableLatex("\\frac{")).toBe("unparsable");
  });

  it("returns 'valid' for empty or whitespace-only strings without calling KaTeX", () => {
    expect(isUnparsableLatex("")).toBe("valid");
    expect(isUnparsableLatex("   \t\n  ")).toBe("valid");
    expect(mockKatex.renderToString).not.toHaveBeenCalled();
  });

  it("returns 'unavailable' when KaTeX is not loaded", () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    expect(isUnparsableLatex("x^2")).toBe("unavailable");
    expect(mockKatex.renderToString).not.toHaveBeenCalled();
  });

  it("calls renderToString with throwOnError: true", () => {
    isUnparsableLatex("x^2");
    expect(mockKatex.renderToString).toHaveBeenCalledWith("x^2", { throwOnError: true });
  });

  it("return type is assignable to LatexCheckResult", () => {
    const result: LatexCheckResult = isUnparsableLatex("x^2");
    expect(["valid", "unparsable", "unavailable"]).toContain(result);
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

  it("strips ```tex fence", () => {
    expect(stripLatexResponse("```tex\n\\frac{1}{2}\n```")).toBe("\\frac{1}{2}");
  });

  it("strips ```LaTeX fence (case-insensitive)", () => {
    expect(stripLatexResponse("```LaTeX\n\\frac{1}{2}\n```")).toBe("\\frac{1}{2}");
  });

  it("strips ```math fence", () => {
    expect(stripLatexResponse("```math\n\\frac{1}{2}\n```")).toBe("\\frac{1}{2}");
  });

  it("strips ```TEX fence (all caps)", () => {
    expect(stripLatexResponse("```TEX\n\\sum_{i=0}^n x_i\n```")).toBe("\\sum_{i=0}^n x_i");
  });

  it("strips ```LATEX fence (all caps)", () => {
    expect(stripLatexResponse("```LATEX\n\\alpha + \\beta\n```")).toBe("\\alpha + \\beta");
  });

  it("strips combined ```math fence + $$ delimiters", () => {
    expect(stripLatexResponse("```math\n$$\\frac{1}{2}$$\n```")).toBe("\\frac{1}{2}");
  });

  it("strips ```latex fence with \\r\\n line endings", () => {
    expect(stripLatexResponse("```latex\r\n\\frac{1}{2}\r\n```")).toBe("\\frac{1}{2}");
  });

  it("strips bare ``` fence with \\r\\n line endings", () => {
    expect(stripLatexResponse("```\r\n\\frac{1}{2}\r\n```")).toBe("\\frac{1}{2}");
  });

  it("strips multi-line fenced content with \\r\\n without leaving stray \\r", () => {
    expect(stripLatexResponse("```latex\r\n\\frac{1}{2} +\r\n\\frac{3}{4}\r\n```")).toBe(
      "\\frac{1}{2} +\n\\frac{3}{4}",
    );
  });

  it("strips combined fence + $$ delimiters with \\r\\n", () => {
    expect(stripLatexResponse("```latex\r\n$$\\frac{1}{2}$$\r\n```")).toBe("\\frac{1}{2}");
  });

  it("strips $...$ delimiters with surrounding \\r\\n whitespace", () => {
    expect(stripLatexResponse("\r\n$\\frac{1}{2}$\r\n")).toBe("\\frac{1}{2}");
  });

  it("does not mangle a lone $ character", () => {
    expect(stripLatexResponse("$")).toBe("$");
  });

  it("does not mangle a lone $$ string", () => {
    expect(stripLatexResponse("$$")).toBe("$$");
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
