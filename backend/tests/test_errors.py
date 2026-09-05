"""Error envelope contract: every failure has code/message/request_id."""


def test_404_envelope(client) -> None:
    r = client.get("/api/v1/models/does-not-exist")
    assert r.status_code == 404
    err = r.json()["error"]
    assert err["code"] == "not_found"
    assert err["message"]
    assert err["request_id"]


def test_validation_envelope(client) -> None:
    r = client.post("/api/v1/tasks", json={"goal": ""})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert err["request_id"]


def test_unknown_route_envelope(client) -> None:
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"
