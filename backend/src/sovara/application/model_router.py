"""Deterministic model router (Slice 3, first version).

Pipeline (availability is a hard constraint, never a score term):

    All Registered Models
            ↓
    Available Models            (hard: drop unavailable/unknown)
            ↓
    Capability Filtering        (hard: modality + context fit;
                                 known-mismatch tasks excluded,
                                 unknown capabilities kept as fallback)
            ↓
    Scoring                     (transparent, additive, explainable)
            ↓
    Best Candidate              (deterministic tie-break)

Unknown capability metadata is treated conservatively: a model that
claims nothing is eligible but never outranks a model that claims the
required capability. A model that explicitly claims *other* capabilities
is excluded for that task (no silent misrouting). No suitable candidate
raises ModelError — the router never silently serves the wrong model.
"""

from __future__ import annotations

from sovara.domain.errors import ModelError
from sovara.domain.model_provider import Modality, ModelRole, TaskCapability
from sovara.domain.model_registry import ModelAvailability, ModelRecord
from sovara.domain.routing import RoutingDecision, ScoredCandidate, TaskProfile
from sovara.infrastructure.logging.structured import get_logger

log = get_logger("sovara.router")

DECISION_SOURCE = "deterministic_router"


class ModelRouter:
    def __init__(self, *, configured_model_id: str | None = None) -> None:
        self._configured_model_id = configured_model_id

    def rebind(self, configured_model_id: str) -> None:
        """Sync the preference bonus after a catalog refresh."""
        self._configured_model_id = configured_model_id

    def route(self, profile: TaskProfile, records: list[ModelRecord]) -> RoutingDecision:
        available = [r for r in records if r.availability == ModelAvailability.AVAILABLE]
        # Harness rule (G1): embedding models are never chat candidates.
        # Role unknown stays eligible (honest fallback); known-embedding is
        # excluded before scoring, never outranked-but-selected.
        chat_eligible = [r for r in available if not _is_embedding(r)]
        if not chat_eligible:
            if available:
                raise ModelError(
                    "No suitable local model available: only embedding models are reachable"
                )
            raise ModelError("No suitable local model available: no local models are reachable")
        available = chat_eligible
        scored: list[ScoredCandidate] = []
        for record in available:
            candidate = self._score(profile, record)
            if candidate is not None:
                scored.append(candidate)
        if not scored:
            raise ModelError(
                f"No suitable local model available for task '{profile.task_type.value}'"
            )
        scored.sort(
            key=lambda c: (
                -c.score,
                0 if c.model_id == self._configured_model_id else 1,
                c.model_id,
            )
        )
        selected = scored[0]
        log.info(
            "routing decision task_type=%s selection_mode=auto selected_model_id=%s "
            "decision_source=%s candidates=%d",
            profile.task_type.value,
            selected.model_id,
            DECISION_SOURCE,
            len(scored),
        )
        return RoutingDecision(
            selected_model_id=selected.model_id,
            task_type=profile.task_type,
            reason_codes=selected.reason_codes,
            candidates=scored,
            decision_source=DECISION_SOURCE,
        )

    def _score(self, profile: TaskProfile, record: ModelRecord) -> ScoredCandidate | None:
        """Score one available model; None means hard-constraint exclusion."""
        score = 0
        reasons: list[str] = ["available_local_runtime"]

        # --- hard: modality fit (vision needs image input support) ---
        if Modality.IMAGE in profile.modalities:
            declared = record.capabilities.modalities
            if declared and Modality.IMAGE not in declared:
                return None
            if Modality.IMAGE in declared:
                score += 2
                reasons.append("modality_match")

        # --- capability matching (respects capability_source honesty) ---
        claimed = set(record.capabilities.tasks)
        required = list(profile.required_tasks)
        if required:
            if claimed:
                missing = [t for t in required if t not in claimed]
                if missing:
                    return None  # explicitly claims other skills: not suitable
                for task in required:
                    score += 3
                    reasons.append(f"{task.value}_capability")
            else:
                # Unknown capabilities: eligible fallback, never outranks a
                # model that claims the required capability (+3 each above).
                reasons.append("capabilities_unknown")

        # --- hard: context fit (unknown window stays eligible, neutral) ---
        if profile.context_chars and record.context_window:
            if profile.context_chars > record.context_window:
                return None
            score += 2
            reasons.append("context_fit")

        # --- soft: modality bonus for text tasks ---
        if (
            Modality.IMAGE not in profile.modalities
            and Modality.TEXT in record.capabilities.modalities
        ):
            score += 1
            reasons.append("text_modality")

        # --- soft: configured default preference (stability, smallest bonus) ---
        if self._configured_model_id and record.model_id == self._configured_model_id:
            score += 1
            reasons.append("configured_default")

        return ScoredCandidate(model_id=record.model_id, score=score, reason_codes=reasons)


def _is_embedding(record: ModelRecord) -> bool:
    """True when the record is a known embedding model (role or task claim)."""
    if record.role == ModelRole.EMBEDDING:
        return True
    return TaskCapability.EMBEDDING in record.capabilities.tasks
