"""Model catalog API tests: normalized shape, refresh, selected-model chat."""

from fastapi.testclient import TestClient


def test_models_normalized_shape(echo_client: TestClient) -> None:
    body = echo_client.get("/api/v1/models").json()
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["id"] == "echo-dev"
    assert item["display_name"] == "Echo (dev harness)"
    assert item["provider"] == "echo"
    assert item["runtime"] == "Dev harness"
    assert item["availability"] == "available"
    assert item["capability_source"] in ("provider", "configured")
    assert item["capabilities"]["supports_streaming"] is True
    assert item["context_window"] is None
    assert body["meta"]["default_model_id"] == "echo-dev"
    assert body["meta"]["routing"] == "deferred"


def test_models_refresh_rebuilds_and_stays_consistent(
    echo_client: TestClient,
) -> None:
    refreshed = echo_client.post("/api/v1/models/refresh").json()
    listed = echo_client.get("/api/v1/models").json()
    assert refreshed["items"] == listed["items"]
    assert refreshed["meta"]["default_model_id"] == "echo-dev"
    # Gateway rebound: explicit id still streams after refresh.
    res = echo_client.post(
        "/api/v1/chat",
        json={"model_id": "echo-dev", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 200
    assert "text/event-stream" in res.headers["content-type"]


def test_chat_with_unavailable_model_is_controlled_502(
    client: TestClient,
) -> None:
    # Default client: Ollama down -> configured fallback, UNAVAILABLE.
    res = client.post(
        "/api/v1/chat",
        json={
            "model_id": "llama3.1",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert res.status_code == 502
    body = res.json()["error"]
    assert body["code"] == "model_error"
    assert "unavailable" in body["message"]


def test_chat_unknown_model_says_unknown(client: TestClient) -> None:
    res = client.post(
        "/api/v1/chat",
        json={"model_id": "ghost", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 502
    assert "unknown" in res.json()["error"]["message"]
