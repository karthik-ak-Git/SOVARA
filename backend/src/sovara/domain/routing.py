"""Smart routing contracts (Phase 1 / Slice 3: deterministic auto-routing).

Router chooses, gateway executes: this module holds the normalized task
profile and routing decision shapes only. Classification lives in
application/task_classifier.py, matching/scoring in
application/model_router.py. No I/O, no LLM calls — the first router is
deterministic, observable, testable, and fast.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

from sovara.domain.model_provider import Modality, TaskCapability


class TaskType(StrEnum):
    """Small, extensible task vocabulary. Start small; grow only with need."""

    GENERAL = "general"
    REASONING = "reasoning"
    CODING = "coding"
    DOCUMENT = "document"
    ANALYSIS = "analysis"
    VISION = "vision"
    DATA = "data"


class SelectionMode(StrEnum):
    """Explicit routing state: auto (router decides) vs manual (user decides)."""

    AUTO = "auto"
    MANUAL = "manual"


class TaskProfile(BaseModel):
    """Normalized description of what the current turn needs."""

    task_type: TaskType = TaskType.GENERAL
    modalities: list[Modality] = Field(default_factory=lambda: [Modality.TEXT])
    required_tasks: list[TaskCapability] = Field(default_factory=list)
    # Input size in chars; used for context-window fit, never logged.
    context_chars: int = Field(default=0, ge=0)
    tool_required: bool = False
    # Where the profile came from: explicit UI hint | input modality | heuristic.
    profile_source: str = "heuristic"


class ScoredCandidate(BaseModel):
    model_id: str
    score: int = 0
    reason_codes: list[str] = Field(default_factory=list)


class RoutingDecision(BaseModel):
    """Explainable auto-routing outcome (concise reasons, no chain-of-thought)."""

    selected_model_id: str
    task_type: TaskType = TaskType.GENERAL
    reason_codes: list[str] = Field(default_factory=list)
    candidates: list[ScoredCandidate] = Field(default_factory=list)
    decision_source: str = "deterministic_router"
