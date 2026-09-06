"""Model registry contract (Slice 2: normalized records + availability).

The registry stores normalized SOVARA model records. It never talks to
runtimes — discovery lives in provider adapters, orchestration in the
ModelCatalog application service. In-memory implementation is sufficient;
no database for metadata in this slice.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import StrEnum

from pydantic import BaseModel, Field

from sovara.domain.model_provider import ModelCapabilities, ModelResource, ModelRole


class ModelAvailability(StrEnum):
    """Registered vs. reachable, kept separate by design (§8)."""

    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


class CapabilitySource(StrEnum):
    """Where a record's capability claims come from — never implied."""

    PROVIDER = "provider"  # reported by the runtime listing itself
    CONFIGURED = "configured"  # declared by SOVARA config / adapter defaults
    INFERRED = "inferred"  # derived by SOVARA analysis (not implemented yet)


class ModelRecord(BaseModel):
    """Canonical SOVARA model representation (Slice 2).

    Unknown values stay null/empty — adapters must not invent metadata.
    """

    model_id: str  # native runtime id, used verbatim in inference calls
    display_name: str = ""  # human label; falls back to model_id when empty
    provider: str  # adapter kind: ollama | lmstudio | echo
    runtime: str = ""  # underlying runtime name, e.g. "LM Studio"
    version: str = ""
    role: ModelRole = ModelRole.UNKNOWN
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    capability_source: CapabilitySource = CapabilitySource.PROVIDER
    context_window: int | None = None
    parameter_size_b: float | None = None
    availability: ModelAvailability = ModelAvailability.UNKNOWN
    metadata: dict[str, str] = Field(default_factory=dict)
    resource: ModelResource = Field(default_factory=ModelResource)

    @property
    def label(self) -> str:
        return self.display_name or self.model_id


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

    @abstractmethod
    def set_availability(self, model_id: str, availability: ModelAvailability) -> bool:
        """Update availability in place; False when the record is unknown."""
