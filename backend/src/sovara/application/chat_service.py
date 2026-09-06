"""Chat application service (Phase 1 / Slice 1, routing in Slice 3).

Owns turn-level policy: request validation against settings caps, model
resolution (manual pick or deterministic auto-routing), and streaming
delegation. Stateless by design — the client sends full history each
turn; server-side memory is deferred.

Manual selection bypasses the router intentionally and is never
overridden. Auto mode classifies the last user turn, routes over the
registry, and double-checks availability through the gateway
(the execution boundary — the router never calls a runtime).

Logging rule: counts, model IDs, task types, and decision sources only.
Message content is never logged (see structured logging
confidential-content guard).
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

from sovara.application.model_gateway import ModelGateway
from sovara.application.model_router import DECISION_SOURCE, ModelRouter
from sovara.application.task_classifier import classify_task
from sovara.domain.chat import ChatMessage
from sovara.domain.errors import ValidationError
from sovara.domain.model_provider import InferenceRequest
from sovara.domain.model_registry import ModelRegistry
from sovara.domain.routing import RoutingDecision, SelectionMode, TaskType
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.logging.structured import get_logger

log = get_logger("sovara.chat")


class ChatService:
    def __init__(
        self,
        settings: Settings,
        gateway: ModelGateway,
        *,
        router: ModelRouter | None = None,
        registry: ModelRegistry | None = None,
    ) -> None:
        self._settings = settings
        self._gateway = gateway
        self._router = router
        self._registry = registry

    def resolve_model_id(self, model_id: str | None) -> str:
        """Resolve + validate the model id without starting generation.

        Lets the route fail fast with a JSON 502 for unknown models instead
        of a mid-stream error event.
        """
        resolved = model_id or self._gateway.default_model_id
        self._gateway.resolve(resolved)
        return resolved

    @staticmethod
    def normalize_selection(
        model_id: str | None, selection_mode: SelectionMode | str | None
    ) -> tuple[SelectionMode, str | None]:
        """Disambiguate auto vs manual (routing state stays explicit).

        - selection_mode="manual" (or a concrete model_id with no mode)
          means the user's explicit choice; the router is bypassed.
        - selection_mode="auto" (or an omitted/"auto" model_id) means the
          router decides; any model_id hint is ignored, never silently used.
        """
        if selection_mode is not None:
            mode = (
                selection_mode
                if isinstance(selection_mode, SelectionMode)
                else SelectionMode(str(selection_mode).lower())
            )
        else:
            mode = (
                SelectionMode.MANUAL if model_id not in (None, "", "auto") else SelectionMode.AUTO
            )
        if mode == SelectionMode.MANUAL:
            return mode, model_id
        return mode, None

    async def decide(
        self,
        messages: list[ChatMessage],
        model_id: str | None = None,
        *,
        selection_mode: SelectionMode | str | None = None,
        task_hint: TaskType | str | None = None,
    ) -> tuple[str, RoutingDecision | None]:
        """Resolve the turn's model id plus the routing decision, if any.

        Manual: explicit id (or the configured default) via the gateway.
        Auto: classify the last user turn, route over available registry
        records, then validate through the gateway. Routing can be disabled
        by settings — auto then falls back to the default model.
        """
        mode, manual_id = self.normalize_selection(model_id, selection_mode)
        if mode == SelectionMode.MANUAL or not self._settings.routing_enabled:
            return self.resolve_model_id(manual_id), None
        if self._router is None or self._registry is None:
            return self.resolve_model_id(None), None
        text = messages[-1].content if messages else ""
        profile = classify_task(text, task_hint=task_hint)
        decision = self._router.route(profile, self._registry.list())
        # Gateway remains the execution boundary: availability double-check.
        self._gateway.resolve(decision.selected_model_id)
        log.info(
            "chat auto-routing task_type=%s selection_mode=auto selected_model_id=%s "
            "decision_source=%s",
            profile.task_type.value,
            decision.selected_model_id,
            DECISION_SOURCE,
        )
        return decision.selected_model_id, decision

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
        # Diagnostic only: routing ids + counts. Message content is
        # never logged (see structured logging confidential-content guard).
        log.info(
            "chat stream started resolved_model_id=%s provider=%s runtime_model_id=%s messages=%d",
            resolved_id,
            provider.info.provider,
            request.model_id,
            len(messages),
        )
        chunks = 0
        try:
            async for delta in provider.stream(request):
                chunks += 1
                yield delta
        finally:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            log.info(
                "chat stream finished resolved_model_id=%s provider=%s "
                "runtime_model_id=%s chunks=%d elapsed_ms=%d",
                resolved_id,
                provider.info.provider,
                request.model_id,
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
