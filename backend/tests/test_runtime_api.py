"""Slice 3 API tests: providers, routing preview, auto chat metadata."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from sovara.infrastructure.config.settings import Settings
from sovara.main import create_app


def _events(text: str) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                out.append(json.loads(line[len("data: ") :]))
    return out


@pytest.fixture()
def down_client() -> TestClient:
    """App with no enabled runtimes: deterministically down in any env."""
    settings = Settings(env="test", enabled_providers=[])
    app = create_app(settings)
    with TestClient(app) as client:
        yield client


def test_providers_endpoint_reports_connection_state(echo_client: TestClient) -> None:
    body = echo_client.get("/api/v1/providers").json()
    by_kind = {i["provider"]: i for i in body["items"]}
    assert set(by_kind) == {"echo", "lmstudio", "ollama"}
    assert by_kind["echo"]["connected"] is True
    assert by_kind["echo"]["model_count"] == 1
    # Other runtimes report live state (True when LM Studio/Ollama runs,
    # False otherwise) — the contract is honesty + separation from models.
    listed = echo_client.get("/api/v1/models").json()["items"]
    for kind, status in by_kind.items():
        assert isinstance(status["connected"], bool)
        assert isinstance(status["detail"], str) and status["detail"] != ""
        assert status["model_count"] == sum(1 for m in listed if m["provider"] == kind)
    assert body["meta"]["source"] == "connection-manager"


def test_routing_decide_previews_without_generating(echo_client: TestClient) -> None:
    res = echo_client.post(
        "/api/v1/routing/decide", json={"text": "Write a Python function to parse CSV"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["selected_model_id"] == "echo-dev"
    assert body["task_profile"]["task_type"] == "coding"
    assert body["decision_source"] == "deterministic_router"
    assert isinstance(body["reason_codes"], list)


def test_routing_decide_rejects_unknown_when_nothing_suitable(
    down_client: TestClient,
) -> None:
    # No enabled runtimes -> controlled 502, not a silent pick.
    res = down_client.post("/api/v1/routing/decide", json={"text": "Hello there"})
    assert res.status_code == 502
    assert "No suitable local model" in res.json()["error"]["message"]


def test_chat_auto_done_event_carries_routing_meta(echo_client: TestClient) -> None:
    res = echo_client.post(
        "/api/v1/chat",
        json={"messages": [{"role": "user", "content": "Write a Python function"}]},
    )
    assert res.status_code == 200
    done = [e for e in _events(res.text) if e["type"] == "done"]
    assert len(done) == 1
    assert done[0]["model_id"] == "echo-dev"
    routing = done[0]["routing"]
    assert routing["auto"] is True
    assert routing["selected_model_id"] == "echo-dev"
    assert routing["decision_source"] == "deterministic_router"


def test_chat_manual_done_event_is_not_auto(echo_client: TestClient) -> None:
    res = echo_client.post(
        "/api/v1/chat",
        json={
            "model_id": "echo-dev",
            "selection_mode": "manual",
            "messages": [{"role": "user", "content": "Write a Python function"}],
        },
    )
    assert res.status_code == 200
    done = [e for e in _events(res.text) if e["type"] == "done"]
    assert len(done) == 1
    assert done[0]["routing"] == {"auto": False}


def test_chat_auto_with_all_runtimes_down_is_controlled_502(
    down_client: TestClient,
) -> None:
    res = down_client.post("/api/v1/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 502
    assert "No suitable local model" in res.json()["error"]["message"]
