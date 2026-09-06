"""Streaming chat boundary (Phase 1 / Slice 1, routing in Slice 3).

POST /chat accepts a stateless turn (model_id + full message history) and
returns a Server-Sent Events stream:

    data: {"type": "token", "delta": "..."}
    data: {"type": "done", "model_id": "...", "finish_reason": "stop",
           "routing": {"auto": true, "task_type": "coding", ...}}
    data: {"type": "error", "code": "...", "message": "..."}

Selection mode: an explicit model_id means manual (the router is
bypassed and never overrides it); an omitted/"auto" model_id — or
selection_mode="auto" — routes deterministically ("SOVARA Auto").
selection_mode="manual" without a model_id uses the configured default.

Pre-stream failures (unknown model, no suitable model, service
validation) surface as regular JSON errors through the Phase 0 envelope.
Mid-stream failures surface as a single `error` event, then the stream
closes. Client disconnect stops iteration so generation is genuinely
cancelled, not merely hidden.
"""

from __future__ import annotations

import asyncio
import json
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from sovara.api.deps import get_chat_service
from sovara.application.chat_service import ChatService
from sovara.domain.chat import ChatMessage, ChatRole
from sovara.domain.errors import SovaraError
from sovara.domain.routing import RoutingDecision
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.logging.structured import get_logger

log = get_logger("sovara.chat")

router = APIRouter(tags=["chat"])


class ChatMessageIn(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=12000)


class ChatRequest(BaseModel):
    model_id: str | None = Field(default=None, max_length=128)
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=64)
    selection_mode: Literal["auto", "manual"] | None = None
    task_type: str | None = Field(default=None, max_length=32)


def _sse(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _routing_meta(decision: RoutingDecision | None, auto: bool) -> dict[str, object] | None:
    if decision is None:
        return {"auto": False} if not auto else {"auto": True, "decision_source": "default"}
    return {
        "auto": True,
        "task_type": decision.task_type.value,
        "selected_model_id": decision.selected_model_id,
        "reason_codes": decision.reason_codes,
        "decision_source": decision.decision_source,
    }


@router.post("/chat")
async def chat_completions(
    body: ChatRequest,
    request: Request,
    service: ChatService = Depends(get_chat_service),
) -> StreamingResponse:
    settings: Settings = request.app.state.settings
    messages = [ChatMessage(role=m.role, content=m.content) for m in body.messages]

    # Resolve BEFORE first byte so unknown/unroutable models fail as JSON
    # (502), not as a mid-stream error event. Raises ModelError/Validation
    # -> error envelope. Diagnostic only: ids + mode (no message content).
    resolved, decision = await service.decide(
        messages,
        body.model_id,
        selection_mode=body.selection_mode,
        task_hint=body.task_type,
    )
    auto = body.selection_mode == "auto" or body.model_id in (None, "auto")
    log.info(
        "chat request routing requested_model_id=%s resolved_model_id=%s "
        "selection_mode=%s task_type=%s",
        body.model_id or "<omitted>",
        resolved,
        "auto" if auto else "manual",
        decision.task_type.value if decision else "-",
    )

    async def event_stream():  # type: ignore[no-untyped-def]
        try:
            gen = service.stream_chat(messages, resolved)
            try:
                async with asyncio.timeout(settings.chat_timeout_s):
                    async for delta in gen:
                        if await request.is_disconnected():
                            await gen.aclose()
                            return
                        yield _sse({"type": "token", "delta": delta})
            except TimeoutError:
                await gen.aclose()
                yield _sse(
                    {
                        "type": "error",
                        "code": "model_error",
                        "message": "Generation timed out",
                    }
                )
                return
            yield _sse(
                {
                    "type": "done",
                    "model_id": resolved,
                    "finish_reason": "stop",
                    "routing": _routing_meta(decision, auto),
                }
            )
        except SovaraError as exc:
            yield _sse({"type": "error", "code": exc.code.value, "message": exc.message})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
