import { useMemo } from "react";
import { highlightCode, classHighlighter } from "@lezer/highlight";
import { yamlLanguage } from "@codemirror/lang-yaml";

interface Props {
  code: string;
  className?: string;
  "data-testid"?: string;
}

interface Token {
  text: string;
  classes: string;
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

  return (
    <pre className={className} {...rest}>
      {tokens.map((tok, i) =>
        tok.classes ? (
          <span key={i} className={tok.classes}>
            {tok.text}
          </span>
        ) : (
          tok.text
        ),
      )}
    </pre>
  );
}
