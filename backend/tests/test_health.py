"""API health + status boundary tests (architectural contracts)."""


def test_root_health_ok(client) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["app"] == "SOVARA"
    assert "x-request-id" in {k.lower() for k in r.headers}


def test_v1_health_ok(client) -> None:
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_system_status_shape(client) -> None:
    r = client.get("/api/v1/status")
    assert r.status_code == 200
    body = r.json()
    assert body["app"] == "SOVARA"
    assert body["network"]["local_only"] is True
    assert body["capabilities"]["agent_loop"] == "deferred"
    assert body["capabilities"]["chat_streaming"] == "slice1"
    assert body["capabilities"]["model_discovery"] == "slice2"
    assert body["models_registered"] == 1
    assert body["tools_registered"] == 0
