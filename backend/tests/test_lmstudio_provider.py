"""LM Studio adapter tests: SSE parsing + unreachable-runtime behavior."""

from __future__ import annotations

import asyncio

import pytest

from sovara.domain.chat import ChatMessage, ChatRole
from sovara.domain.errors import ModelError
from sovara.domain.model_provider import InferenceRequest
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.models.factory import build_provider
from sovara.infrastructure.models.lmstudio.lmstudio_provider import LMStudioProvider
from sovara.infrastructure.security.network_policy import NetworkPolicy


def _provider() -> LMStudioProvider:
    return LMStudioProvider(
        base_url="http://127.0.0.1:1/v1",  # unroutable port: fast, deterministic
        model="test-model",
        timeout_s=0.5,
    )


def test_parses_content_deltas() -> None:
    line = 'data: {"choices": [{"delta": {"content": "Hello "}}]}'
    assert LMStudioProvider.parse_sse_lines(line) == ["Hello "]


def test_ignores_done_blanks_comments_and_malformed() -> None:
    assert LMStudioProvider.parse_sse_lines("data: [DONE]") == []
    assert LMStudioProvider.parse_sse_lines("") == []
    assert LMStudioProvider.parse_sse_lines(": keep-alive") == []
    assert LMStudioProvider.parse_sse_lines("data: not-json{{{") == []
    assert LMStudioProvider.parse_sse_lines('data: {"choices": []}') == []
    assert LMStudioProvider.parse_sse_lines('data: {"choices": [{"delta": {}}]}') == []


def test_runtime_error_payload_raises_model_error() -> None:
    with pytest.raises(ModelError):
        LMStudioProvider.parse_sse_lines('data: {"error": "overloaded"}')


def test_messages_preferred_over_prompt() -> None:
    req = InferenceRequest(
        model_id="test-model",
        prompt="ignored",
        messages=[ChatMessage(role=ChatRole.USER, content="hi")],
    )
    assert LMStudioProvider._to_oai_messages(req) == [{"role": "user", "content": "hi"}]


def test_health_reports_unreachable() -> None:
    health = asyncio.run(_provider().health())
    assert health.available is False


def test_stream_unreachable_raises_model_error() -> None:
    async def drain() -> None:
        async for _ in _provider().stream(InferenceRequest(model_id="test-model", prompt="hi")):
            pass

    with pytest.raises(ModelError) as exc:
        asyncio.run(drain())
    assert exc.value.status_code == 502


def test_factory_builds_lmstudio_and_registers() -> None:
    settings = Settings(
        env="development",
        model_provider="lmstudio",
        model_default_id="local-default",
        lmstudio_model="test-model",
    )
    provider, native = asyncio.run(build_provider(settings, NetworkPolicy(local_only=True)))
    assert provider.info.provider == "lmstudio"
    assert native == "test-model"


def test_factory_denies_remote_lmstudio_under_local_only() -> None:
    from sovara.domain.errors import SecurityPolicyError

    settings = Settings(
        env="development",
        model_provider="lmstudio",
        lmstudio_base_url="http://models.corp.example:1234/v1",
    )
    with pytest.raises(SecurityPolicyError):
        asyncio.run(build_provider(settings, NetworkPolicy(local_only=True)))
