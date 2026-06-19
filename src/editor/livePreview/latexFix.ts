import { getKatexSync } from "./katexLoader";
import type { LlmPromptStreamingArgs } from "../../lib/ipc";
import { resolveCurrentLlmProvider } from "../../lib/resolveCurrentLlmProvider";

export interface LatexFixTarget {
  brokenLatex: string;
  from: number;
  to: number;
}

export type LatexCheckResult = "valid" | "unparsable" | "unavailable";

export function checkLatex(latex: string): LatexCheckResult {
  if (!latex.trim()) return "valid";
  const katex = getKatexSync();
  if (!katex) return "unavailable";
  try {
    katex.renderToString(latex, { throwOnError: true });
    return "valid";
  } catch {
    return "unparsable";
  }
}

export const LATEX_FIX_SYSTEM_PROMPT =
  "You are a LaTeX repair assistant. Given broken LaTeX, return ONLY the corrected LaTeX expression. No explanation, no markdown fences, no dollar-sign delimiters — just the raw LaTeX.";

const FENCE_RE = /^```(?:(?:la)?tex|math)?\s*\n([\s\S]*?)\n?```$/i;

export function stripLatexResponse(text: string): string {
  let result = text.replace(/\r\n/g, "\n").trim();
  const fenceMatch = result.match(FENCE_RE);
  if (fenceMatch) result = (fenceMatch[1] ?? "").trim();
  if (result.length > 2 && result.startsWith("$$") && result.endsWith("$$")) {
    result = result.slice(2, -2);
  } else if (result.length > 2 && result.startsWith("$") && result.endsWith("$")) {
    result = result.slice(1, -1);
  }
  return result.trim();
}

export function buildLatexFixArgs(brokenLatex: string): LlmPromptStreamingArgs {
  return {
    ...resolveCurrentLlmProvider(),
    text: brokenLatex,
    system: LATEX_FIX_SYSTEM_PROMPT,
  };
}
