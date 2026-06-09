import {
  StreamLanguage,
  LanguageSupport,
  type StreamParser,
  type StringStream,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";

interface BibState {
  /** Set true after an `=` until the value ends (`,` or entry close). */
  inValue: boolean;
  /**
   * Open-brace depth of an in-progress braced value. 0 when not inside a
   * braced value. Persisted across line boundaries so multi-line braced
   * values resume correctly (StreamLanguage re-invokes token() per line and
   * only state placed in BibState survives the EOL).
   */
  braceDepth: number;
}

/**
 * Consume a quoted value `"..."` (the opening quote is at the stream head).
 * Always advances at least one character so the tokenizer can never stall, even
 * on an unterminated quote that runs to EOF.
 */
function eatQuoted(stream: StringStream): void {
  stream.next(); // opening quote
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === '"') return;
  }
}

/**
 * Consume (part of) a braced value `{...}` with balanced nesting, tracking the
 * open-brace depth in `state.braceDepth` so the value can span multiple lines.
 *
 * - When starting a fresh value the opening brace is at the stream head and
 *   `state.braceDepth` is 0; the leading `{` pushes depth to 1.
 * - When resuming after a newline `state.braceDepth` is already > 0 and the
 *   stream head is mid-value.
 *
 * Returns when the matching close brace drops depth back to 0, or — on an
 * unterminated value — when EOL is reached. In the latter case `braceDepth` is
 * left > 0 so the next line resumes with the same nesting. Always advances at
 * least one character so the tokenizer can never stall.
 */
function eatBracedInto(stream: StringStream, state: BibState): void {
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === "\\") { stream.next(); continue; }
    if (ch === "{") state.braceDepth++;
    else if (ch === "}") {
      state.braceDepth--;
      if (state.braceDepth === 0) return;
    }
  }
}

const parser: StreamParser<BibState> = {
  name: "bibtex",
  startState() {
    return { inValue: false, braceDepth: 0 };
  },
  token(stream, state) {
    // Resume a braced value that started on an earlier line. This must run
    // BEFORE comment/space handling: inside a braced value a leading `%` or
    // indentation is part of the value, not a comment or skippable space.
    if (state.braceDepth > 0) {
      eatBracedInto(stream, state);
      if (state.braceDepth === 0) state.inValue = false;
      return "string";
    }

    // Comments: a `%` runs to end of line.
    if (stream.peek() === "%") {
      stream.skipToEnd();
      return "lineComment";
    }

    if (stream.eatSpace()) return null;

    // Entry type: `@article`, `@book`, ...
    if (stream.match(/^@[A-Za-z]+/)) {
      state.inValue = false;
      return "entryType";
    }

    const ch = stream.peek();

    // String concatenation operator.
    if (ch === "#") {
      stream.next();
      return "op";
    }

    // Field assignment.
    if (ch === "=") {
      stream.next();
      state.inValue = true;
      return "defOp";
    }

    // Value terminators reset value mode.
    if (ch === "," || ch === "}") {
      stream.next();
      state.inValue = false;
      return null;
    }

    // Quoted string value.
    if (ch === '"') {
      eatQuoted(stream);
      return "string";
    }

    // Entry-opening (structural) brace: a `{` outside a value. Consume just the
    // one char as punctuation so the cite key that follows is tokenized on its
    // own instead of being swallowed into a runaway "string" token.
    if (ch === "{" && !state.inValue) {
      stream.next();
      return "punctuation";
    }

    // Braced string value.
    if (ch === "{") {
      eatBracedInto(stream, state);
      if (state.braceDepth === 0) state.inValue = false;
      return "string";
    }

    // A bare identifier before `=` inside an entry is a field name.
    if (!state.inValue && /[A-Za-z]/.test(ch ?? "")) {
      stream.match(/^[A-Za-z][\w-]*/);
      return "fieldName";
    }

    // Fallback: always advance to avoid an infinite loop.
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "%" },
  },
  tokenTable: {
    entryType: tags.typeName,
    fieldName: tags.propertyName,
    defOp: tags.definitionOperator,
    string: tags.string,
    lineComment: tags.lineComment,
    op: tags.operator,
    punctuation: tags.brace,
  },
};

const bibtexLanguage = StreamLanguage.define(parser);

export function bibtex(): LanguageSupport {
  return new LanguageSupport(bibtexLanguage);
}
