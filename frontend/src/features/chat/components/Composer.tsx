import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatStatus } from "../types";

interface ComposerProps {
  status: ChatStatus;
  disabled: boolean;
  disabledReason?: string;
  onSend: (content: string) => void;
  onStop: () => void;
}

const MAX_CHARS = 12000;

export function Composer({
  status,
  disabled,
  disabledReason,
  onSend,
  onStop,
}: ComposerProps): JSX.Element {
  const [value, setValue] = useState("");
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const streaming = status === "streaming";

  useEffect(() => {
    const el = areaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const send = useCallback(() => {
    if (streaming || disabled || value.trim() === "") return;
    onSend(value);
    setValue("");
  }, [streaming, disabled, value, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div className="sv-composer-wrap">
      {disabled && disabledReason !== undefined && (
        <p className="sv-composer-warn" role="alert">
          {disabledReason}
        </p>
      )}
      <div className="sv-composer">
        <textarea
          ref={areaRef}
          rows={1}
          value={value}
          maxLength={MAX_CHARS}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled ? "Chat unavailable — model not ready" : "Message SOVARA… (Enter to send, Shift+Enter for newline)"
          }
          aria-label="Message SOVARA"
        />
        {streaming ? (
          <button
            type="button"
            className="sv-send sv-stop"
            onClick={onStop}
            aria-label="Stop generation"
          >
            ■ Stop
          </button>
        ) : (
          <button
            type="button"
            className="sv-send"
            onClick={send}
            disabled={disabled || value.trim() === ""}
            aria-label="Send message"
          >
            ↑ Send
          </button>
        )}
      </div>
      <div className="sv-composer-meta">
        <span>
          {value.length}/{MAX_CHARS}
        </span>
        <span>SOVARA can make mistakes. Verify important information.</span>
      </div>
    </div>
  );
}
