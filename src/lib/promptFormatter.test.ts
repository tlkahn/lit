import { describe, it, expect } from "vitest";
import { parsePrefix, formatLlmPrompt } from "./promptFormatter";

describe("parsePrefix", () => {
  it("bare question returns ask prefix", () => {
    expect(parsePrefix("hello")).toEqual({ prefix: "ask", question: "hello" });
  });

  it("/ask prefix extracts question", () => {
    expect(parsePrefix("/ask what is this")).toEqual({ prefix: "ask", question: "what is this" });
  });

  it("/insert prefix extracts question", () => {
    expect(parsePrefix("/insert summarize")).toEqual({ prefix: "insert", question: "summarize" });
  });

  it("/rewrite prefix extracts question", () => {
    expect(parsePrefix("/rewrite improve")).toEqual({ prefix: "rewrite", question: "improve" });
  });

  it("unknown prefix treated as bare question", () => {
    expect(parsePrefix("/unknown foo")).toEqual({ prefix: "ask", question: "/unknown foo" });
  });

  it("empty string returns ask with empty question", () => {
    expect(parsePrefix("")).toEqual({ prefix: "ask", question: "" });
  });
});

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
