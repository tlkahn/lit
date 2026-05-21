export interface PromptParts {
  question: string;
  context?: string;
  filePath?: string;
}

export function formatLlmPrompt(opts: PromptParts): string {
  const parts: string[] = [];
  if (opts.filePath) parts.push(`File: ${opts.filePath}`);
  if (opts.context) parts.push(`Context:\n${opts.context}`);
  parts.push(opts.question);
  return parts.join("\n\n");
}
