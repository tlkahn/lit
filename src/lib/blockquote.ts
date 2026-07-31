/**
 * Prefixes every line of `text` with "> ", matching the backend's
 * `blockquote` in src-tauri/src/commands/cardbox/mod.rs (Rust `str::lines`
 * semantics: \r\n normalized, a single trailing newline dropped, empty
 * input stays empty).
 */
export function blockquote(text: string): string {
  if (text === "") return "";
  const normalized = text.replace(/\r\n/g, "\n");
  const withoutTrailing = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  return withoutTrailing
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}
