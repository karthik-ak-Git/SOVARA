import { useCallback, useEffect, useRef, useState } from "react";

interface CodeBlockProps {
  language: string;
  code: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (permissions, insecure context): fallback.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }
}

export function CodeBlock({ language, code }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    void copyText(code).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div className="sv-codeblock">
      <div className="sv-codeblock-bar">
        <span className="sv-codeblock-lang">{language === "" ? "code" : language}</span>
        <button
          type="button"
          className="sv-codeblock-copy"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="sv-codeblock-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}
