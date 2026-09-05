"""Model registry contract (Phase 0: interface only).

Stores model metadata so a future router can select models by task.
No intelligent routing in Phase 0.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field

from sovara.domain.model_provider import ModelCapabilities, ModelResource


class ModelRecord(BaseModel):
    model_id: str
    provider: str
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    resource: ModelResource = Field(default_factory=ModelResource)
    available: bool = False


class ModelRegistry(ABC):
    @abstractmethod
    def register(self, record: ModelRecord) -> None:
        """Register or replace a model record."""

    @abstractmethod
    def get(self, model_id: str) -> ModelRecord | None:
        """Fetch a record by ID, or None when unknown."""

    @abstractmethod
    def list(self) -> list[ModelRecord]:
        """List all known records (order not guaranteed)."""

    @abstractmethod
    def remove(self, model_id: str) -> bool:
        """Remove a record; returns True when something was removed."""
