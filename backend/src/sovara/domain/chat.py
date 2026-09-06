"""Chat turn types (Phase 1 / Slice 1).

The chat API is stateless: the client sends the full message history on each
turn and the backend forwards it to the resolved ModelProvider. Conversation
persistence (server-side memory) is deferred; the UI keeps local history.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class ChatRole(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class ChatMessage(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=12000)
