"""Deterministic dev harness provider (non-production only).

Streams a fixed, content-free response so the full vertical slice
(UI -> API -> gateway -> provider -> streaming -> UI) is verifiable
without a local LLM runtime installed. Never echoes user content back
(the reply carries only message counts, never prompt text).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from sovara.domain.model_provider import (
    InferenceRequest,
    InferenceResponse,
    Modality,
    ModelCapabilities,
    ModelHealth,
    ModelInfo,
    ModelProvider,
    TaskCapability,
)

_TEMPLATE = (
    "SOVARA dev harness reply. Context holds {n} message(s); "
    "the last turn was sent by '{role}'. "
    "Install a local runtime (Ollama) and set SOVARA_MODEL_PROVIDER=ollama "
    "for real inference. This streamed response verifies the full "
    "UI-to-provider pipeline end to end."
)


class EchoProvider(ModelProvider):
    """In-process streaming stub. Refused in production by the factory."""

    def __init__(self, *, model_id: str = "echo-dev") -> None:
        self._info = ModelInfo(
            model_id=model_id,
            display_name="Echo (dev harness)",
            provider="echo",
            version="0.1.0-slice1",
            capabilities=ModelCapabilities(
                modalities=[Modality.TEXT],
                tasks=[TaskCapability.REASONING],
                supports_streaming=True,
                supports_tools=False,
            ),
        )

    @property
    def info(self) -> ModelInfo:
        return self._info

    async def health(self) -> ModelHealth:
        return ModelHealth(model_id=self._info.model_id, available=True, detail="dev-harness")

    async def list_models(self) -> list[ModelInfo]:
        return [self._info]

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        text = "".join([chunk async for chunk in self.stream(request)])
        return InferenceResponse(model_id=self._info.model_id, text=text, finish_reason="stop")

    async def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        n = len(request.messages)
        role = request.messages[-1].role.value if n else "user"
        for word in _TEMPLATE.format(n=n, role=role).split(" "):
            await asyncio.sleep(0.005)
            yield word + " "
