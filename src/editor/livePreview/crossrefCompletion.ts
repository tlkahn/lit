import {
  type CompletionContext,
  type CompletionResult,
  type Completion,
  startCompletion,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { getDefinitions } from "../../lib/ipc";
import { frontmatterFacet } from "./crossref";
import { bibEntriesField } from "./citeproc";

export interface TriggerInfo {
  from: number;
  phase: "type" | "id";
  refType?: string;
  bibFrom?: number;
}

const REF_TYPES: { label: string; detail: string }[] = [
  { label: "fig:", detail: "Figure" },
  { label: "tbl:", detail: "Table" },
  { label: "sec:", detail: "Section" },
  { label: "eq:", detail: "Equation" },
  { label: "lst:", detail: "Listing" },
  { label: "bib:", detail: "Bibliography" },
];

export function parseTrigger(
  lineText: string,
  lineStart: number,
  posInLine: number,
): TriggerInfo | null {
  const before = lineText.slice(0, posInLine);

  const bracketIdx = before.lastIndexOf("[");
  if (bracketIdx === -1) return null;

  const afterBracket = before.slice(bracketIdx);
  if (!afterBracket.startsWith("[@")) return null;

  if (afterBracket.indexOf("]", 2) !== -1) return null;

  const lastSemi = afterBracket.lastIndexOf(";");
  let segmentStart: number;
  let segment: string;

  if (lastSemi !== -1) {
    const afterSemi = afterBracket.slice(lastSemi + 1);
    const atMatch = afterSemi.match(/^\s*@/);
    if (!atMatch) return null;
    segmentStart = bracketIdx + lastSemi + 1 + atMatch[0].length;
    segment = afterSemi.slice(atMatch[0].length);
  } else {
    segmentStart = bracketIdx + 2;
    segment = afterBracket.slice(2);
  }

  const colonIdx = segment.indexOf(":");
  if (colonIdx === -1) {
    const from = lineStart + segmentStart;
    return { from, phase: "type" };
  }

  const refType = segment.slice(0, colonIdx);
  const validTypes = ["fig", "tbl", "sec", "eq", "lst", "bib"];
  if (!validTypes.includes(refType)) return null;

  const afterColon = lineStart + segmentStart + colonIdx + 1;

  if (refType === "bib") {
    const atPos =
      lastSemi !== -1
        ? before.lastIndexOf("@", posInLine)
        : bracketIdx + 1;
    return { from: afterColon, phase: "id", refType, bibFrom: lineStart + atPos };
  }

  return { from: afterColon, phase: "id", refType };
}

export async function crossrefCompletionSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const posInLine = pos - line.from;

  const trigger = parseTrigger(line.text, line.from, posInLine);
  if (!trigger) return null;

  if (trigger.phase === "type") {
    const options: Completion[] = REF_TYPES.map((t) => ({
      label: t.label,
      detail: t.detail,
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        view.dispatch({ changes: { from, to, insert: t.label } });
        startCompletion(view);
      },
    }));
    return {
      from: trigger.from,
      options,
      validFor: /^[a-z]*$/,
    };
  }

  if (trigger.refType === "bib") {
    const bibData = state.field(bibEntriesField, false);
    if (!bibData) return null;
    const options: Completion[] = bibData.entries.map((entry) => ({
      label: entry.key,
      detail: bibData.renderedCitations[entry.key] ?? entry.key,
      apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
        view.dispatch({ changes: { from: trigger.bibFrom!, to, insert: entry.key } });
      },
    }));
    return {
      from: trigger.from,
      options,
      validFor: /^[a-zA-Z0-9_-]*$/,
    };
  }

  const frontmatter = state.facet(frontmatterFacet);
  const content = state.doc.toString();
  try {
    const defs = await getDefinitions(content, frontmatter);
    const filtered = defs.filter((d) => d.ref_type === trigger.refType);
    const options: Completion[] = filtered.map((d) => ({
      label: d.id,
      detail: `${d.number}${d.caption ? ": " + d.caption : ""}`,
    }));
    return {
      from: trigger.from,
      options,
      validFor: /^[a-zA-Z0-9_-]*$/,
    };
  } catch {
    return null;
  }
}
