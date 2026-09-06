interface StatusIndicatorProps {
  modelId: string | null;
  available: boolean;
  localOnly: boolean;
}

/** Backend posture at a glance. Never claims more than the API reports. */
export function StatusIndicator({
  modelId,
  available,
  localOnly,
}: StatusIndicatorProps): JSX.Element {
  return (
    <div className="sv-status" role="status" aria-label="Backend status">
      <span className={available ? "sv-dot-ok" : "sv-dot-bad"} aria-hidden="true" />
      <span className="sv-status-local">{localOnly ? "LOCAL" : "NETWORK"}</span>
      <span className="sv-status-model" title={modelId ?? "no model registered"}>
        {modelId ?? "no model"}
      </span>
    </div>
  );
}
