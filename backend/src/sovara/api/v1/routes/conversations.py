"""Conversation boundary (Phase 0: validated echo, no persistence, no LLM)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from pydantic import BaseModel, Field

from sovara.api.schemas import PHASE, PlaceholderItem, PlaceholderList

router = APIRouter(tags=["conversations"])


class ConversationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    metadata: dict[str, str] = Field(default_factory=dict)


@router.get("/conversations", response_model=PlaceholderList)
def list_conversations() -> PlaceholderList:
    return PlaceholderList(items=[], meta={"phase": PHASE, "persistence": "deferred"})


@router.post("/conversations", response_model=PlaceholderItem, status_code=201)
def create_conversation(body: ConversationCreate) -> PlaceholderItem:
    return PlaceholderItem(
        id=uuid.uuid4().hex[:12],
        kind="conversation",
        echo={"title": body.title, "metadata": body.metadata},
    )
