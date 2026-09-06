"""Chat application service (Phase 1 / Slice 1).

Owns turn-level policy: request validation against settings caps, provider
resolution via the gateway, and streaming delegation. Stateless by design —
the client sends full history each turn; server-side memory is deferred.

Logging rule: counts, model IDs, and latencies only. Message content is
never logged (see structured logging confidential-content guard).
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

from sovara.application.model_gateway import ModelGateway
from sovara.domain.chat import ChatMessage
from sovara.domain.errors import ValidationError
from sovara.domain.model_provider import InferenceRequest
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.logging.structured import get_logger

log = get_logger("sovara.chat")


class ChatService:
    def __init__(self, settings: Settings, gateway: ModelGateway) -> None:
        self._settings = settings
        self._gateway = gateway

    def resolve_model_id(self, model_id: str | None) -> str:
        """Resolve + validate the model id without starting generation.

        Lets the route fail fast with a JSON 502 for unknown models instead
        of a mid-stream error event.
        """
        resolved = model_id or self._gateway.default_model_id
        self._gateway.resolve(resolved)
        return resolved

    async def stream_chat(
        self, messages: list[ChatMessage], model_id: str | None = None
    ) -> AsyncIterator[str]:
        self._validate(messages)
        provider = self._gateway.resolve(model_id)
        resolved_id = model_id or self._gateway.default_model_id
        prompt = messages[-1].content
        request = InferenceRequest(
            model_id=resolved_id,
            prompt=prompt,
            messages=messages,
        )
        started = time.perf_counter()
        log.info("chat stream started model=%s messages=%d", resolved_id, len(messages))
        chunks = 0
        try:
            async for delta in provider.stream(request):
                chunks += 1
                yield delta
        finally:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            log.info(
                "chat stream finished model=%s chunks=%d elapsed_ms=%d",
                resolved_id,
                chunks,
                elapsed_ms,
            )

    def _validate(self, messages: list[ChatMessage]) -> None:
        if not messages:
            raise ValidationError("At least one message is required")
        if len(messages) > self._settings.chat_max_messages:
            raise ValidationError(
                f"Too many messages: {len(messages)} > {self._settings.chat_max_messages}"
            )
        total = sum(len(m.content) for m in messages)
        if total > self._settings.chat_max_prompt_chars:
            raise ValidationError(
                f"Prompt too large: {total} chars > {self._settings.chat_max_prompt_chars}"
            )
