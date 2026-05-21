import { describe, it, expect } from "vitest";
import { formatLlmPrompt } from "./promptFormatter";

describe("formatLlmPrompt", () => {
  it("question only", () => {
    expect(formatLlmPrompt({ question: "what is this?" })).toBe("what is this?");
  });

  it("with filePath", () => {
    expect(formatLlmPrompt({ question: "q", filePath: "notes/topic.md" })).toBe(
      "File: notes/topic.md\n\nq",
    );
  });

  it("with context", () => {
    expect(formatLlmPrompt({ question: "q", context: "selected text" })).toBe(
      "Context:\nselected text\n\nq",
    );
  });

  it("both filePath and context", () => {
    expect(formatLlmPrompt({ question: "q", filePath: "f.md", context: "ctx" })).toBe(
      "File: f.md\n\nContext:\nctx\n\nq",
    );
  });

  it("empty context and filePath omitted", () => {
    expect(formatLlmPrompt({ question: "q", context: "", filePath: "" })).toBe("q");
  });

  it("undefined context and filePath omitted", () => {
    expect(formatLlmPrompt({ question: "q", context: undefined, filePath: undefined })).toBe("q");
  });
});
