import { getKatexSync } from "./katexLoader";
import type { LlmPromptStreamingArgs } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";

export interface LatexFixTarget {
  brokenLatex: string;
  from: number;
  to: number;
}

export function isUnparsableLatex(latex: string): boolean {
  if (!latex.trim()) return false;
  const katex = getKatexSync();
  if (!katex) return false;
  try {
    katex.renderToString(latex, { throwOnError: true });
    return false;
  } catch {
    return true;
  }
}

export const LATEX_FIX_SYSTEM_PROMPT =
  "You are a LaTeX repair assistant. Given broken LaTeX, return ONLY the corrected LaTeX expression. No explanation, no markdown fences, no dollar-sign delimiters — just the raw LaTeX.";

const FENCE_RE = /^```(?:latex)?\s*\n([\s\S]*?)\n?```$/;

export function stripLatexResponse(text: string): string {
  let result = text.trim();
  const fenceMatch = result.match(FENCE_RE);
  if (fenceMatch) result = (fenceMatch[1] ?? "").trim();
  if (result.startsWith("$$") && result.endsWith("$$")) {
    result = result.slice(2, -2);
  } else if (result.startsWith("$") && result.endsWith("$")) {
    result = result.slice(1, -1);
  }
  return result.trim();
}

export function buildLatexFixArgs(brokenLatex: string): LlmPromptStreamingArgs {
  const prefs = usePreferencesStore.getState();
  const customDef = prefs.llmProvider.providerId.startsWith("custom-")
    ? prefs.llmCustomProviders.find((p) => p.id === prefs.llmProvider.providerId)
    : undefined;
  return {
    provider: prefs.llmProvider.providerId,
    model: prefs.llmProvider.model,
    text: brokenLatex,
    system: LATEX_FIX_SYSTEM_PROMPT,
    baseUrl: prefs.llmProvider.baseUrl ?? customDef?.baseUrl,
    contextWindow: customDef?.contextWindow,
  };
}
