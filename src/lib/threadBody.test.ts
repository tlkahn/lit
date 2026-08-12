import { describe, it, expect } from "vitest";
import { parseThreadBody, serializeThreadBody, type ThreadTurn } from "./threadBody";

// Exact wire-format example from the plan (between `---` and `--->`).
const WIRE_EXAMPLE = [
  "[q]: What does this passage mean?",
  "",
  "This passage discusses the concept of dharma...",
  "",
  "[q]: Can you elaborate on the etymology?",
  "",
  "The term derives from the root √dhṛ...",
].join("\n");

describe("parseThreadBody", () => {
  it("parses the normal two-turn wire-format example", () => {
    const turns = parseThreadBody(WIRE_EXAMPLE);
    expect(turns).toEqual([
      {
        question: "What does this passage mean?",
        response: "This passage discusses the concept of dharma...",
      },
      {
        question: "Can you elaborate on the etymology?",
        response: "The term derives from the root √dhṛ...",
      },
    ]);
  });

  it("parses a single turn with [q]: prefix", () => {
    const body = "[q]: What is dharma?\n\nDharma is a concept.";
    expect(parseThreadBody(body)).toEqual([
      { question: "What is dharma?", response: "Dharma is a concept." },
    ]);
  });

  it("treats text with no [q]: prefix as a single response with empty question", () => {
    const body = "Just a raw response with no question prefix.";
    expect(parseThreadBody(body)).toEqual([
      { question: "", response: "Just a raw response with no question prefix." },
    ]);
  });

  it("treats a multiline no-prefix body as a single response", () => {
    const body = "Line one of the response.\n\nLine two of the response.";
    expect(parseThreadBody(body)).toEqual([
      { question: "", response: "Line one of the response.\n\nLine two of the response." },
    ]);
  });

  it("returns [] for an empty string", () => {
    expect(parseThreadBody("")).toEqual([]);
  });

  it("returns [] for a whitespace-only string", () => {
    expect(parseThreadBody("   \n\n  \t ")).toEqual([]);
  });

  it("trims trailing whitespace and blank lines from the response", () => {
    const body = "[q]: Q?\n\nThe answer.\n\n   \n";
    expect(parseThreadBody(body)).toEqual([
      { question: "Q?", response: "The answer." },
    ]);
  });

  it("does NOT split when [q]: appears mid-line inside a response", () => {
    const body = "[q]: Real question?\n\nHere is text with [q]: not-a-delimiter inline.";
    expect(parseThreadBody(body)).toEqual([
      {
        question: "Real question?",
        response: "Here is text with [q]: not-a-delimiter inline.",
      },
    ]);
  });

  it("DOES split when [q]: appears at line start inside body (ambiguity is intentional)", () => {
    const body = "[q]: First?\n\nFirst answer.\n\n[q]: Second?\n\nSecond answer.";
    expect(parseThreadBody(body)).toEqual([
      { question: "First?", response: "First answer." },
      { question: "Second?", response: "Second answer." },
    ]);
  });

  it("retains a final turn with an empty response (streaming-in-progress)", () => {
    const body = "[q]: question\n\n";
    expect(parseThreadBody(body)).toEqual([
      { question: "question", response: "" },
    ]);
  });

  it("retains a streaming turn after a completed turn", () => {
    const body = "[q]: First?\n\nFirst answer.\n\n[q]: Second?\n\n";
    expect(parseThreadBody(body)).toEqual([
      { question: "First?", response: "First answer." },
      { question: "Second?", response: "" },
    ]);
  });

  it("preserves internal markdown whitespace in the response", () => {
    const body = "[q]: code?\n\n```js\nconst x = 1;\n```";
    expect(parseThreadBody(body)).toEqual([
      { question: "code?", response: "```js\nconst x = 1;\n```" },
    ]);
  });
});

describe("serializeThreadBody", () => {
  it("returns an empty string for empty turns", () => {
    expect(serializeThreadBody([])).toBe("");
  });

  it("serializes a single complete turn", () => {
    const turns: ThreadTurn[] = [{ question: "Q?", response: "A." }];
    expect(serializeThreadBody(turns)).toBe("[q]: Q?\n\nA.");
  });

  it("round-trips a multi-turn body (parse → serialize → parse)", () => {
    const turns = parseThreadBody(WIRE_EXAMPLE);
    const reparsed = parseThreadBody(serializeThreadBody(turns));
    expect(reparsed).toEqual(turns);
  });

  it("round-trips a turn with an empty response", () => {
    const turns: ThreadTurn[] = [{ question: "Q?", response: "" }];
    const reparsed = parseThreadBody(serializeThreadBody(turns));
    expect(reparsed).toEqual([{ question: "Q?", response: "" }]);
  });

  it("round-trips an empty-question single response turn", () => {
    const turns: ThreadTurn[] = [{ question: "", response: "raw response" }];
    const reparsed = parseThreadBody(serializeThreadBody(turns));
    expect(reparsed).toEqual([{ question: "", response: "raw response" }]);
  });

  it("round-trips a multi-turn body whose later turn has an empty question", () => {
    const turns: ThreadTurn[] = [
      { question: "A", response: "r" },
      { question: "", response: "x" },
    ];
    const reparsed = parseThreadBody(serializeThreadBody(turns));
    expect(reparsed).toEqual(turns);
  });

  it("round-trips a later empty-question, empty-response turn", () => {
    const turns: ThreadTurn[] = [
      { question: "A", response: "r" },
      { question: "", response: "" },
    ];
    const reparsed = parseThreadBody(serializeThreadBody(turns));
    expect(reparsed).toEqual(turns);
  });

  it("emits a [q]: delimiter for a non-leading empty-question turn", () => {
    const out = serializeThreadBody([
      { question: "A", response: "r" },
      { question: "", response: "x" },
    ]);
    expect(out.match(/(?:^|\n)\[q\]: /g)?.length).toBe(2);
  });

  it("keeps the bare no-prefix form for a leading empty-question turn", () => {
    expect(serializeThreadBody([{ question: "", response: "raw" }])).toBe("raw");
  });
});


