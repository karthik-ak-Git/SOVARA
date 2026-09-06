"""Chat API tests: validation, streaming, errors, log hygiene (Slice 1)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from sovara.application.chat_service import ChatService
from sovara.application.model_gateway import ModelGateway
from sovara.domain.errors import ModelError
from sovara.domain.model_provider import InferenceRequest, ModelProvider
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.models.echo_provider import EchoProvider


def _events(text: str) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                out.append(json.loads(line[len("data: ") :]))
    return out


def _turn(content: str = "Hello SOVARA") -> dict[str, object]:
    return {"messages": [{"role": "user", "content": content}]}


def test_chat_rejects_empty_messages(echo_client: TestClient) -> None:
    res = echo_client.post("/api/v1/chat", json={"messages": []})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_chat_rejects_bad_role(echo_client: TestClient) -> None:
    res = echo_client.post("/api/v1/chat", json={"messages": [{"role": "wizard", "content": "hi"}]})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_chat_rejects_too_many_messages(echo_client: TestClient) -> None:
    msgs = [{"role": "user", "content": "x"} for _ in range(65)]
    res = echo_client.post("/api/v1/chat", json={"messages": msgs})
    assert res.status_code == 422


def test_chat_unknown_model_is_json_502(echo_client: TestClient) -> None:
    res = echo_client.post("/api/v1/chat", json={"model_id": "nope", **_turn()})
    assert res.status_code == 502
    body = res.json()["error"]
    assert body["code"] == "model_error"
    assert "request_id" in body


def test_chat_streams_tokens_then_done(echo_client: TestClient) -> None:
    res = echo_client.post("/api/v1/chat", json=_turn())
    assert res.status_code == 200
    assert "text/event-stream" in res.headers["content-type"]
    events = _events(res.text)
    tokens = [e for e in events if e["type"] == "token"]
    done = [e for e in events if e["type"] == "done"]
    assert len(tokens) > 5  # genuinely progressive, not one blob
    assert len(done) == 1
    assert done[0]["model_id"] == "echo-dev"
    assert done[0]["finish_reason"] == "stop"
    assert not [e for e in events if e["type"] == "error"]


class _FailProvider(ModelProvider):
    """Fails mid-stream after one token (generation-failure path)."""

    def __init__(self) -> None:
        self._echo = EchoProvider(model_id="fail-dev")

    @property
    def info(self):  # type: ignore[no-untyped-def]
        return self._echo.info

    async def health(self):  # type: ignore[no-untyped-def]
        return await self._echo.health()

    async def infer(self, request: InferenceRequest):  # type: ignore[no-untyped-def]
        return await self._echo.infer(request)

    async def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        yield "partial "
        raise ModelError("boom mid-stream")


def test_chat_midstream_failure_is_error_event(
    echo_settings: Settings, echo_client: TestClient
) -> None:
    app = echo_client.app
    gateway = ModelGateway(
        registry=app.state.models,
        providers={"fail-dev": _FailProvider()},
        default_model_id="fail-dev",
    )
    app.state.gateway = gateway
    app.state.chat_service = ChatService(settings=echo_settings, gateway=gateway)
    res = echo_client.post("/api/v1/chat", json=_turn())
    events = _events(res.text)
    assert [e for e in events if e["type"] == "token"]  # partial output preserved
    errors = [e for e in events if e["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "model_error"
    assert not [e for e in events if e["type"] == "done"]


def test_chat_timeout_is_error_event(echo_settings: Settings) -> None:
    echo_settings.chat_timeout_s = 0.001  # echo needs ~0.2s; forces timeout
    from sovara.main import create_app

    app = create_app(echo_settings)
    with TestClient(app) as client:
        res = client.post("/api/v1/chat", json=_turn())
    events = _events(res.text)
    errors = [e for e in events if e["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["message"] == "Generation timed out"


def test_chat_never_logs_content(echo_client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    secret = "CONFIDENTIAL-PROJECT-FALCON-9ZQ"
    with caplog.at_level(logging.INFO):
        echo_client.post("/api/v1/chat", json=_turn(secret))
    assert secret not in caplog.text
