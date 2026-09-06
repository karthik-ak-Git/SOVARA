"""Smart routing boundary (Slice 3, Part B).

POST /routing/decide previews the deterministic routing decision for a
piece of text without generating anything: task profile, selected model,
concise reason codes, and scored candidates. Chat turns use the same path
inside ChatService — this endpoint only makes it inspectable.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from sovara.api.deps import get_model_registry, get_model_router
from sovara.application.model_router import ModelRouter
from sovara.application.task_classifier import classify_task
from sovara.domain.model_registry import ModelRegistry
from sovara.domain.routing import TaskType

router = APIRouter(tags=["routing"])


class RoutingDecideRequest(BaseModel):
    text: str = Field(default="", max_length=24000)
    task_type: TaskType | None = None


@router.post("/routing/decide")
def decide_routing(
    body: RoutingDecideRequest,
    router: ModelRouter = Depends(get_model_router),
    registry: ModelRegistry = Depends(get_model_registry),
) -> dict[str, object]:
    profile = classify_task(body.text, task_hint=body.task_type)
    decision = router.route(profile, registry.list())
    return {
        "selected_model_id": decision.selected_model_id,
        "task_profile": profile.model_dump(),
        "reason_codes": decision.reason_codes,
        "candidates": [c.model_dump() for c in decision.candidates],
        "decision_source": decision.decision_source,
    }
