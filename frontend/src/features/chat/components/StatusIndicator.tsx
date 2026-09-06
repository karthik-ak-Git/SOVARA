import type { ModelAvailability } from "../../../api/types";

interface StatusIndicatorProps {
  modelDisplayName: string | null;
  availability: ModelAvailability | "unknown";
  localOnly: boolean;
}

/** Backend posture at a glance. Never claims more than the API reports. */
export function StatusIndicator({
  modelDisplayName,
  availability,
  localOnly,
}: StatusIndicatorProps): JSX.Element {
  const dot =
    availability === "available"
      ? "sv-dot-ok"
      : availability === "unavailable"
        ? "sv-dot-bad"
        : "sv-dot-unknown";
  return (
    <div className="sv-status" role="status" aria-label="Backend status">
      <span className={dot} aria-hidden="true" />
      <span className="sv-status-local">{localOnly ? "LOCAL" : "NETWORK"}</span>
      <span
        className="sv-status-model"
        title={modelDisplayName ?? "no model registered"}
      >
        {modelDisplayName ?? "no model"}
      </span>
    </div>
  );
}
