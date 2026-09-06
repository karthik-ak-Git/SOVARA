import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelItem } from "../../../api/types";
import {
  availabilityText,
  capabilityLabels,
  formatContextWindow,
  modelLabel,
} from "../lib/models";

interface ModelSelectorProps {
  models: ModelItem[];
  selectedId: string | null;
  loading: boolean;
  loadError: boolean;
  onSelect: (id: string) => void;
  onRetryLoad: () => void;
}

function AvailabilityDot({ model }: { model: ModelItem }): JSX.Element {
  const cls =
    model.availability === "available"
      ? "sv-dot-ok"
      : model.availability === "unavailable"
        ? "sv-dot-bad"
        : "sv-dot-unknown";
  return <span className={cls} aria-hidden="true" />;
}

/**
 * Manual model picker (dropdown + details). Reads registry records only;
 * selection flows up as selectedModelId — no routing, per ADR-0009.
 */
export function ModelSelector({
  models,
  selectedId,
  loading,
  loadError,
  onSelect,
  onRetryLoad,
}: ModelSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = models.find((m) => m.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const choose = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
    },
    [onSelect],
  );

  const buttonLabel = loading
    ? "Loading models…"
    : (selected !== null ? modelLabel(selected) : "Select model");

  return (
    <div className="sv-modelsel" ref={rootRef}>
      <button
        type="button"
        className="sv-modelsel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select model"
        onClick={() => setOpen((o) => !o)}
        disabled={loading || (models.length === 0 && !loadError)}
      >
        {selected !== null && <AvailabilityDot model={selected} />}
        <span className="sv-modelsel-name">{buttonLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="sv-modelsel-pop" role="listbox" aria-label="Available models">
          <p className="sv-modelsel-head">SOVARA Local</p>
          {loadError && models.length === 0 && (
            <div className="sv-modelsel-err">
              <p role="alert">Could not load models.</p>
              <button type="button" className="sv-chip" onClick={onRetryLoad}>
                ↻ Retry
              </button>
            </div>
          )}
          {models.map((m) => {
            const disabled = m.availability === "unavailable";
            const ctx = formatContextWindow(m.context_window);
            const caps = capabilityLabels(m).join(" • ");
            const meta = [caps, ctx].filter((s) => s !== "").join(" • ");
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={m.id === selectedId}
                aria-disabled={disabled}
                disabled={disabled}
                className={
                  m.id === selectedId
                    ? "sv-modelsel-opt sv-modelsel-active"
                    : "sv-modelsel-opt"
                }
                onClick={() => choose(m.id)}
                title={disabled ? `${modelLabel(m)} (${availabilityText(m.availability)})` : modelLabel(m)}
              >
                <AvailabilityDot model={m} />
                <span className="sv-modelsel-opt-main">
                  <span className="sv-modelsel-opt-name">{modelLabel(m)}</span>
                  {meta !== "" && (
                    <span className="sv-modelsel-opt-meta">{meta}</span>
                  )}
                </span>
                <span className="sv-modelsel-opt-state">
                  {availabilityText(m.availability)}
                </span>
              </button>
            );
          })}
          {selected !== null && (
            <dl className="sv-modelsel-details">
              <div>
                <dt>Model</dt>
                <dd>{modelLabel(selected)}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{selected.runtime !== "" ? selected.runtime : "—"}</dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>
                  {capabilityLabels(selected).join(", ") !== ""
                    ? capabilityLabels(selected).join(", ")
                    : "Unknown"}
                </dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>{formatContextWindow(selected.context_window) ?? "—"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{availabilityText(selected.availability)}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>Local</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
