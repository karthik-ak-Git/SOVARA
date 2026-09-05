"""Task boundary (Phase 0: validated echo, no agent loop, no execution)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from pydantic import BaseModel, Field

from sovara.api.schemas import PHASE, PlaceholderItem, PlaceholderList

router = APIRouter(tags=["tasks"])


class TaskCreate(BaseModel):
    goal: str = Field(min_length=1, max_length=2000)
    context: dict[str, str] = Field(default_factory=dict)


@router.get("/tasks", response_model=PlaceholderList)
def list_tasks() -> PlaceholderList:
    return PlaceholderList(items=[], meta={"phase": PHASE, "agent_loop": "deferred"})


@router.post("/tasks", response_model=PlaceholderItem, status_code=201)
def create_task(body: TaskCreate) -> PlaceholderItem:
    return PlaceholderItem(
        id=uuid.uuid4().hex[:12],
        kind="task",
        echo={"goal": body.goal, "context": body.context},
    )
