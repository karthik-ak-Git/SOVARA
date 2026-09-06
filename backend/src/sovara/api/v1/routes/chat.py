"""Streaming chat boundary (Phase 1 / Slice 1).

POST /chat accepts a stateless turn (model_id + full message history) and
returns a Server-Sent Events stream:

    data: {"type": "token", "delta": "..."}
    data: {"type": "done", "model_id": "...", "finish_reason": "stop"}
    data: {"type": "error", "code": "...", "message": "..."}

Pre-stream failures (unknown model, service validation) surface as regular
JSON errors through the Phase 0 envelope. Mid-stream failures surface as a
single `error` event, then the stream closes. Client disconnect stops
iteration so generation is genuinely cancelled, not merely hidden.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from sovara.api.deps import get_chat_service
from sovara.application.chat_service import ChatService
from sovara.domain.chat import ChatMessage, ChatRole
from sovara.domain.errors import SovaraError
from sovara.infrastructure.config.settings import Settings

router = APIRouter(tags=["chat"])


class ChatMessageIn(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=12000)


class ChatRequest(BaseModel):
    model_id: str | None = Field(default=None, max_length=128)
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=64)


def _sse(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/chat")
async def chat_completions(
    body: ChatRequest,
    request: Request,
    service: ChatService = Depends(get_chat_service),
) -> StreamingResponse:
    settings: Settings = request.app.state.settings
    messages = [ChatMessage(role=m.role, content=m.content) for m in body.messages]

    # Resolve BEFORE first byte so unknown models fail as JSON (502),
    # not as a mid-stream error event. Raises ModelError -> error envelope.
    resolved = service.resolve_model_id(body.model_id)

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
            yield _sse({"type": "done", "model_id": resolved, "finish_reason": "stop"})
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
