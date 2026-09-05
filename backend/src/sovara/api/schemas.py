"""Common API schemas (envelopes + placeholder markers)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

PHASE = "phase0-placeholder"


class HealthResponse(BaseModel):
    status: str = "ok"
    app: str
    version: str
    env: str


class PlaceholderItem(BaseModel):
    id: str
    kind: str
    status: str = PHASE
    echo: dict[str, Any] = Field(default_factory=dict)


class PlaceholderList(BaseModel):
    items: list[PlaceholderItem] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=lambda: {"phase": PHASE})
