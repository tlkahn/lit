import { useCallback, useMemo } from "react";
import { highlightCode, classHighlighter } from "@lezer/highlight";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { openUrl } from "@tauri-apps/plugin-opener";

interface Props {
  code: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLPreElement>;
  "data-testid"?: string;
}

interface Token {
  text: string;
  classes: string;
}

export interface Segment {
  text: string;
  isUrl: boolean;
}

export function isHttpUrl(text: string): boolean {
  return text.startsWith("http://") || text.startsWith("https://");
}

export function splitTokenByUrls(text: string): Segment[] {
  const re = /https?:\/\/[^\s"'\\]+/g;
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isUrl: false });
    }
    segments.push({ text: match[0], isUrl: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isUrl: false });
  }
  if (segments.length === 0) {
    segments.push({ text, isUrl: false });
  }
  return segments;
}

export function YamlHighlighter({ code, className, ...rest }: Props) {
  const tokens = useMemo(() => {
    if (!code) return [];
    const result: Token[] = [];
    const tree = yamlLanguage.parser.parse(code);
    highlightCode(
      code,
      tree,
      classHighlighter,
      (text, classes) => result.push({ text, classes }),
      () => result.push({ text: "\n", classes: "" }),
    );
    return result;
  }, [code]);

  const handleUrlClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      e.stopPropagation();
      openUrl(e.currentTarget.getAttribute("href")!);
    },
    [],
  );

  return (
    <pre className={className} {...rest}>
      {tokens.map((tok, i) => {
        const segments = splitTokenByUrls(tok.text);
        const hasUrl = segments.some((s) => s.isUrl);
        if (!hasUrl) {
          return tok.classes ? (
            <span key={i} className={tok.classes}>
              {tok.text}
            </span>
          ) : (
            tok.text
          );
        }
        return segments.map((seg, j) => {
          if (seg.isUrl) {
            return (
              <a
                key={`${i}-${j}`}
                href={seg.text}
                className={`yaml-url ${tok.classes}`.trim()}
                onClick={handleUrlClick}
              >
                {seg.text}
              </a>
            );
          }
          return tok.classes ? (
            <span key={`${i}-${j}`} className={tok.classes}>
              {seg.text}
            </span>
          ) : (
            seg.text
          );
        });
      })}
    </pre>
  );
}
