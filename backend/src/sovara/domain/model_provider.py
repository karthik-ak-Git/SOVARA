"""Model provider contract (Phase 0: interface only).

The rest of SOVARA must never couple to a specific model runtime
(llama.cpp, vLLM, Ollama, ...). All inference goes through ModelProvider.
Real implementations land in later phases under infrastructure/.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class Modality(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"


class TaskCapability(StrEnum):
    REASONING = "reasoning"
    CODING = "coding"
    VISION = "vision"
    EMBEDDING = "embedding"
    OCR = "ocr"


class ModelCapabilities(BaseModel):
    modalities: list[Modality] = Field(default_factory=list)
    tasks: list[TaskCapability] = Field(default_factory=list)
    supports_streaming: bool = False
    supports_tools: bool = False


class ModelResource(BaseModel):
    parameters_b: float | None = None
    context_window: int | None = None
    requires_gpu_gb: float | None = None


class ModelInfo(BaseModel):
    model_id: str
    provider: str
    version: str = "0.0.0-phase0"
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    resource: ModelResource = Field(default_factory=ModelResource)


class ModelHealth(BaseModel):
    model_id: str
    available: bool
    latency_ms: int | None = None
    detail: str = "phase0-placeholder"


class InferenceRequest(BaseModel):
    model_id: str
    prompt: str
    max_tokens: int = 256
    temperature: float = 0.2
    metadata: dict[str, Any] = Field(default_factory=dict)


class InferenceResponse(BaseModel):
    model_id: str
    text: str
    finish_reason: str = "phase0_placeholder"
    usage: dict[str, int] = Field(default_factory=dict)


class ModelProvider(ABC):
    """Abstraction over any local model runtime. No network calls in Phase 0."""

    @property
    @abstractmethod
    def info(self) -> ModelInfo:
        """Static identification + capability advertisement."""

    @abstractmethod
    async def health(self) -> ModelHealth:
        """Liveness/readiness without running inference."""

    @abstractmethod
    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        """Single-shot inference (implemented in later phases)."""

    @abstractmethod
    def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        """Token streaming (implemented in later phases)."""
