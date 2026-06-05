/**
 * Thread body wire-format utilities.
 *
 * A thread annotation stores its conversation in the DSL block body — the text
 * between the `\n---\n` separator and the closing `--->`. Turns are delimited by
 * a line-start `[q]: ` prefix:
 *
 *   [q]: What does this passage mean?
 *
 *   This passage discusses the concept of dharma...
 *
 *   [q]: Can you elaborate on the etymology?
 *
 *   The term derives from the root √dhṛ...
 *
 * Splitting is line-start only (`(^|\n)[q]: `), so a `[q]: ` appearing mid-line
 * inside a response is NOT treated as a delimiter.
 *
 * KNOWN LIMITATION: a legitimate LLM response that contains a line *starting*
 * with `[q]: ` will be (mis)parsed as a new turn boundary. The wire format does
 * not escape this; callers that need round-trip fidelity for such content are
 * out of scope for this format.
 */

export interface ThreadTurn {
  question: string;
  response: string;
}

/** A single chat message in the shape consumed by `llmPromptStreaming`. */
interface Message {
  role: string;
  content: string;
}

// Matches the turn delimiter only at the start of a line (or the very start of
// the body). Global so we can iterate every boundary.
const TURN_DELIMITER = /(?:^|\n)\[q\]: /g;

/** Strip trailing whitespace (including blank lines), keep leading/internal. */
function trimTrailing(text: string): string {
  return text.replace(/\s+$/, "");
}

/**
 * Split a turn segment (everything after a `[q]: ` boundary) into its question
 * and response. The question is the first line; the response is the remainder
 * with the leading newline run removed and trailing whitespace trimmed.
 */
function parseSegment(segment: string): ThreadTurn {
  const newlineIdx = segment.indexOf("\n");
  if (newlineIdx === -1) {
    // Question only, no response yet (streaming-in-progress).
    return { question: trimTrailing(segment), response: "" };
  }
  const question = segment.slice(0, newlineIdx);
  // Drop the run of blank lines separating question from response.
  const rest = segment.slice(newlineIdx + 1).replace(/^\n+/, "");
  return { question: trimTrailing(question), response: trimTrailing(rest) };
}

/** Parse a thread body into its constituent turns. */
export function parseThreadBody(body: string): ThreadTurn[] {
  if (body.trim() === "") return [];

  // Collect the index of each line-start `[q]: ` delimiter.
  const boundaries: number[] = [];
  TURN_DELIMITER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TURN_DELIMITER.exec(body)) !== null) {
    boundaries.push(match.index);
    // Avoid zero-length-loop edge: exec advances lastIndex past the match.
  }

  // No `[q]: ` delimiter at all → single response with empty question.
  if (boundaries.length === 0) {
    return [{ question: "", response: trimTrailing(body) }];
  }

  // Any text before the first delimiter is a leading no-prefix response.
  const turns: ThreadTurn[] = [];
  const preamble = body.slice(0, boundaries[0]);
  if (preamble.trim() !== "") {
    turns.push({ question: "", response: trimTrailing(preamble) });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i] ?? 0;
    const end = boundaries[i + 1] ?? body.length;
    // Skip the delimiter text itself (a leading "\n" for non-first matches,
    // plus the "[q]: " prefix).
    const delimMatch = body.slice(start, end).match(/^\n?\[q\]: /);
    const segment = body.slice(start + (delimMatch ? delimMatch[0].length : 0), end);
    turns.push(parseSegment(segment));
  }

  return turns;
}

/**
 * Serialize turns back into the wire-format body. Round-trips with
 * `parseThreadBody` for normal and empty-response turns.
 */
export function serializeThreadBody(turns: ThreadTurn[]): string {
  return turns
    .map((turn) => {
      if (turn.question === "") {
        // No-prefix single response — emit the response verbatim.
        return turn.response;
      }
      if (turn.response === "") {
        // Streaming-in-progress turn — question only.
        return `[q]: ${turn.question}`;
      }
      return `[q]: ${turn.question}\n\n${turn.response}`;
    })
    .join("\n\n");
}

/**
 * Append a new turn to a body, normalizing the existing content by routing it
 * through parse → push → serialize.
 */
export function appendTurn(body: string, question: string, response: string): string {
  const turns = parseThreadBody(body);
  turns.push({ question, response });
  return serializeThreadBody(turns);
}

/**
 * Convert turns into the `messages[]` shape consumed by `llmPromptStreaming`.
 * Empty-content messages are skipped: an empty-question turn (no-prefix single
 * response) emits only the assistant message, and a final empty-response turn
 * (the follow-up being asked) emits only the user message.
 */
export function turnsToMessages(turns: ThreadTurn[]): Message[] {
  const messages: Message[] = [];
  for (const turn of turns) {
    if (turn.question !== "") {
      messages.push({ role: "user", content: turn.question });
    }
    if (turn.response !== "") {
      messages.push({ role: "assistant", content: turn.response });
    }
  }
  return messages;
}
