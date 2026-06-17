import type { EnrichResult, BibEntry } from "./ipc";

export interface EnrichCandidateState {
  bibKey: string;
  title: string;
  candidates: BibEntry[];
  providersSearched: string[];
  providersFailed: string[];
}

export type ClassifiedEnrichResult =
  | { kind: "candidates" } & EnrichCandidateState
  | { kind: "miss"; title: string; message: string }
  | { kind: "success"; message: string };

/**
 * Classify an EnrichResult into one of three branches:
 *
 * 1. **candidates** -- backend returned candidate matches for the user to pick from
 * 2. **miss** -- nothing was found at all
 * 3. **success** -- enrichment applied automatically (fields added / references / shadow nodes)
 */
export function classifyEnrichResult(
  result: EnrichResult,
  bibKey: string,
  title: string,
): ClassifiedEnrichResult {
  // Branch (a): candidates returned
  if (result.candidates.length > 0) {
    return {
      kind: "candidates",
      bibKey,
      title,
      candidates: result.candidates,
      providersSearched: result.providers_searched,
      providersFailed: result.providers_failed,
    };
  }

  // Branch (b): total miss
  const totalMiss =
    result.fields_added.length === 0 &&
    result.references_appended === 0 &&
    result.shadow_nodes_created === 0;

  if (totalMiss) {
    return {
      kind: "miss",
      title,
      message: `No metadata found for ‘${title}’. Try searching manually.`,
    };
  }

  // Branch (c): normal success
  const parts: string[] = [];
  if (result.fields_added.length > 0) {
    parts.push(`added ${result.fields_added.join(", ")}`);
  }
  if (result.references_appended > 0) {
    const qualifier =
      result.references_found > result.references_appended
        ? ` of ${result.references_found}`
        : "";
    parts.push(`${result.references_appended}${qualifier} references added`);
  }
  if (result.shadow_nodes_created > 0) {
    parts.push(`${result.shadow_nodes_created} shadow nodes created`);
  }

  return {
    kind: "success",
    message: `Enriched ${bibKey}${parts.length > 0 ? ": " + parts.join(". ") : ""}`,
  };
}
