import { useCallback, useState } from "react";
import type { UiMessage } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageProps {
  message: UiMessage;
  streaming: boolean;
}

export function Message({ message, streaming }: MessageProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(message.content)
      .then(() => setCopied(true))
      .catch(() => undefined);
    window.setTimeout(() => setCopied(false), 1500);
  }, [message.content]);

  if (message.role === "user") {
    return (
      <div className="sv-msg sv-msg-user">
        <div className="sv-bubble">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="sv-msg sv-msg-assistant">
      <div className="sv-avatar" aria-hidden="true">
        S
      </div>
      <div className="sv-answer">
        {message.content === "" ? (
          <span className="sv-thinking" role="status" aria-label="Generating response">
            <span className="sv-dot" />
            <span className="sv-dot" />
            <span className="sv-dot" />
          </span>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
        {message.content !== "" && !streaming && (
          <button
            type="button"
            className="sv-msg-copy"
            onClick={handleCopy}
            aria-label="Copy response to clipboard"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
