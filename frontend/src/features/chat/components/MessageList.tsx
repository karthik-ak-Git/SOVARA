import { useCallback, useEffect, useRef, useState } from "react";
import type { UiMessage } from "../types";
import { Message } from "./Message";

interface MessageListProps {
  messages: UiMessage[];
  streamingId: string | null;
}

export function EmptyState(): JSX.Element {
  return (
    <div className="sv-empty">
      <div className="sv-empty-mark" aria-hidden="true">
        S
      </div>
      <h2>How can I help?</h2>
      <p>
        SOVARA runs on a local model inside your infrastructure.
        Ask anything — code, documents, analysis.
      </p>
      <ul className="sv-empty-hints">
        <li>Explain what SOVARA is in one paragraph.</li>
        <li>Write a Python function that parses CSV safely.</li>
        <li>Draft an outline for a safety inspection report.</li>
      </ul>
    </div>
  );
}

export function MessageList({ messages, streamingId }: MessageListProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null && stuck) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, stuck]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
      setStuck(true);
    }
  }, []);

  if (messages.length === 0) {
    return (
      <div className="sv-scroll" ref={scrollRef} onScroll={handleScroll}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="sv-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div className="sv-messages" role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((m) => (
          <Message key={m.id} message={m} streaming={m.id === streamingId} />
        ))}
      </div>
      {!stuck && (
        <button
          type="button"
          className="sv-scroll-bottom"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  );
}
