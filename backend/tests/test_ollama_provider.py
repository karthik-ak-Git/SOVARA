"""Ollama adapter tests: message mapping + unreachable-runtime behavior."""

from __future__ import annotations

import asyncio

import pytest

from sovara.domain.chat import ChatMessage, ChatRole
from sovara.domain.errors import ModelError
from sovara.domain.model_provider import InferenceRequest
from sovara.infrastructure.models.ollama.ollama_provider import OllamaProvider


def _provider() -> OllamaProvider:
    return OllamaProvider(
        base_url="http://127.0.0.1:1",  # unroutable port: fast, deterministic
        model="test-model",
        timeout_s=0.5,
    )


def test_messages_preferred_over_prompt() -> None:
    req = InferenceRequest(
        model_id="test-model",
        prompt="ignored",
        messages=[
            ChatMessage(role=ChatRole.SYSTEM, content="sys"),
            ChatMessage(role=ChatRole.USER, content="hi"),
        ],
    )
    assert OllamaProvider._to_ollama_messages(req) == [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "hi"},
    ]


def test_prompt_fallback_when_no_messages() -> None:
    req = InferenceRequest(model_id="test-model", prompt="solo")
    assert OllamaProvider._to_ollama_messages(req) == [{"role": "user", "content": "solo"}]


def test_health_reports_unreachable() -> None:
    health = asyncio.run(_provider().health())
    assert health.available is False
    assert health.model_id == "test-model"


def test_stream_unreachable_raises_model_error() -> None:
    async def drain() -> None:
        async for _ in _provider().stream(InferenceRequest(model_id="test-model", prompt="hi")):
            pass

    with pytest.raises(ModelError) as exc:
        asyncio.run(drain())
    assert exc.value.status_code == 502


def test_list_models_unreachable_returns_empty() -> None:
    assert asyncio.run(_provider().list_models()) == []


def test_parse_param_size() -> None:
    parse = OllamaProvider._parse_param_size
    assert parse("8.0B") == 8.0
    assert parse("4B") == 4.0
    assert parse("350M") == pytest.approx(0.35)
    assert parse("nonsense") is None
    assert parse(None) is None
    assert parse(8) is None
