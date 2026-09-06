"""Slice 3 API tests: providers, routing preview, auto chat metadata."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient


def _events(text: str) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                out.append(json.loads(line[len("data: ") :]))
    return out


def test_providers_endpoint_reports_connection_state(echo_client: TestClient) -> None:
    body = echo_client.get("/api/v1/providers").json()
    by_kind = {i["provider"]: i for i in body["items"]}
    assert set(by_kind) == {"echo", "lmstudio", "ollama"}
    assert by_kind["echo"]["connected"] is True
    assert by_kind["echo"]["model_count"] == 1
    # No local runtime installed here: honest unavailable, never fabricated.
    assert by_kind["lmstudio"]["connected"] is False
    assert by_kind["ollama"]["connected"] is False
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


def test_routing_decide_rejects_unknown_when_nothing_suitable(client: TestClient) -> None:
    # Default client: every runtime down -> controlled 502, not a silent pick.
    res = client.post("/api/v1/routing/decide", json={"text": "Hello there"})
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


def test_chat_auto_with_all_runtimes_down_is_controlled_502(client: TestClient) -> None:
    res = client.post("/api/v1/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 502
    assert "No suitable local model" in res.json()["error"]["message"]
