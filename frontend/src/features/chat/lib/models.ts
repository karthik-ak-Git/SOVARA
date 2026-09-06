/** Model presentation helpers (pure, tested via ModelSelector tests). */

import type { ModelItem } from "../../../api/types";

const TASK_LABELS: Record<string, string> = {
  reasoning: "Reasoning",
  coding: "Coding",
  vision: "Vision",
  embedding: "Embedding",
  document: "Document",
  tool_use: "Tool use",
  long_context: "Long context",
  ocr: "OCR",
};

/** Top capability labels for a model row (max 2, honest unknowns omitted). */
export function capabilityLabels(model: ModelItem): string[] {
  return model.capabilities.tasks
    .map((t) => TASK_LABELS[t] ?? t)
    .slice(0, 2);
}

/** 32000 -> "32K", 1500 -> "1.5K", null -> null (caller renders fallback). */
export function formatContextWindow(value: number | null): string | null {
  if (value === null || value <= 0) return null;
  if (value >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(value);
}

/** "qwen/qwen3.5-9b" style ids already arrive with display names; fallback. */
export function modelLabel(model: ModelItem): string {
  return model.display_name !== "" ? model.display_name : model.id;
}

const REASON_LABELS: Record<string, string> = {
  available_local_runtime: "Local runtime available",
  capabilities_unknown: "General capability",
  configured_default: "Preferred default",
  context_fit: "Context fits",
  modality_match: "Input supported",
  text_modality: "Text input",
};

/** "coding_capability" -> "Coding capability"; known codes get plain labels. */
export function reasonLabel(code: string): string {
  const known = REASON_LABELS[code];
  if (known !== undefined) return known;
  if (code.endsWith("_capability")) {
    const task = code.slice(0, -"_capability".length);
    return `${task.slice(0, 1).toUpperCase()}${task.slice(1)} capability`;
  }
  return code;
}

/** Top routing reasons as a compact human line (max 3, no internals). */
export function summarizeReasons(codes: string[] | undefined): string {
  if (codes === undefined || codes.length === 0) return "";
  return codes.slice(0, 3).map(reasonLabel).join(" • ");
}

export function availabilityText(
  availability: ModelItem["availability"],
): string {
  if (availability === "available") return "Available";
  if (availability === "unavailable") return "Unavailable";
  return "Unknown";
}
