export type LlmPrefix = "ask" | "insert" | "rewrite";

export interface ParsedInput {
  prefix: LlmPrefix;
  question: string;
}

export interface PromptParts {
  question: string;
  context?: string;
  filePath?: string;
}

const VALID_PREFIXES: readonly LlmPrefix[] = ["ask", "insert", "rewrite"] as const;

export function parsePrefix(input: string): ParsedInput {
  const match = input.match(/^\/(\S+)\s*(.*)/s);
  if (match) {
    const candidate = match[1]!.toLowerCase();
    if (VALID_PREFIXES.includes(candidate as LlmPrefix)) {
      return { prefix: candidate as LlmPrefix, question: match[2]! };
    }
  }
  return { prefix: "ask", question: input };
}

export function formatLlmPrompt(opts: PromptParts): string {
  const parts: string[] = [];
  if (opts.filePath) parts.push(`File: ${opts.filePath}`);
  if (opts.context) parts.push(`Context:\n${opts.context}`);
  parts.push(opts.question);
  return parts.join("\n\n");
}
