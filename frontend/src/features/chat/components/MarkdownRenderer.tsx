import type { ReactNode } from "react";
import { Children, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import { CodeBlock } from "./CodeBlock";

interface MarkdownRendererProps {
  content: string;
}

/** Route fenced blocks through CodeBlock (language label + copy button). */
function PreBlock({ children }: { children?: ReactNode }): JSX.Element {
  const kids = Children.toArray(children);
  const first = kids.length === 1 && isValidElement(kids[0]) ? kids[0] : null;
  const props =
    first !== null
      ? (first.props as { className?: string; children?: ReactNode })
      : null;
  const match = /language-([\w+-]+)/.exec(props?.className ?? "");
  if (props !== null) {
    const code = Children.toArray(props.children)
      .map((c) => (typeof c === "string" ? c : ""))
      .join("")
      .replace(/\n$/, "");
    return <CodeBlock language={match?.[1] ?? ""} code={code} />;
  }
  return <pre>{children}</pre>;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps): JSX.Element {
  return (
    <div className="sv-markdown">
      <ReactMarkdown components={{ pre: PreBlock }}>{content}</ReactMarkdown>
    </div>
  );
}
