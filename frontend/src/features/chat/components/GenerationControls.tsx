import type { ChatError, ChatStatus, UiMessage } from "../types";

interface GenerationControlsProps {
  status: ChatStatus;
  error: ChatError | null;
  messages: UiMessage[];
  onStop: () => void;
  onRetry: () => void;
  onRegenerate: () => void;
}

const FRIENDLY: Record<ChatError["kind"], string> = {
  model_unavailable: "Local model is unavailable. Start the runtime and try again.",
  validation: "That message could not be sent. Shorten it and retry.",
  generation: "Generation failed before completing.",
  connection: "Lost connection to the SOVARA backend.",
  cancelled: "Generation stopped.",
};

/**
 * Context actions rendered between the transcript and the composer:
 * Stop while streaming, Retry on error, Regenerate when idle.
 */
export function GenerationControls({
  status,
  error,
  messages,
  onStop,
  onRetry,
  onRegenerate,
}: GenerationControlsProps): JSX.Element | null {
  if (status === "streaming") {
    return (
      <div className="sv-controls">
        <button type="button" className="sv-chip" onClick={onStop}>
          ■ Stop generating
        </button>
      </div>
    );
  }
  if (status === "error" && error !== null && error.kind !== "cancelled") {
    return (
      <div className="sv-controls">
        <p className="sv-error" role="alert">
          {error.message !== "" ? error.message : FRIENDLY[error.kind]}
        </p>
        <button type="button" className="sv-chip" onClick={onRetry}>
          ↻ Retry
        </button>
      </div>
    );
  }
  const hasAssistantAnswer = messages.some((m) => m.role === "assistant");
  if (status === "idle" && hasAssistantAnswer) {
    return (
      <div className="sv-controls">
        <button type="button" className="sv-chip sv-chip-quiet" onClick={onRegenerate}>
          ↻ Regenerate response
        </button>
      </div>
    );
  }
  return null;
}
