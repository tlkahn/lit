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
 * Consume a braced value `{...}` with balanced nesting (the opening brace is at
 * the stream head). Always advances at least one character; on an unterminated
 * brace it consumes to EOL and returns so the tokenizer cannot loop forever.
 */
function eatBraced(stream: StringStream): void {
  let depth = 0;
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return;
    }
  }
}

const parser: StreamParser<BibState> = {
  name: "bibtex",
  startState() {
    return { inValue: false };
  },
  token(stream, state) {
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

    // Braced string value.
    if (ch === "{") {
      eatBraced(stream);
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
  },
};

const bibtexLanguage = StreamLanguage.define(parser);

export function bibtex(): LanguageSupport {
  return new LanguageSupport(bibtexLanguage);
}
