"""CORS boundary tests: allowlisted browser origins only."""

from fastapi.testclient import TestClient

ORIGIN = "http://localhost:5173"


def test_allowlisted_origin_gets_acao_header(client: TestClient) -> None:
    res = client.get("/api/v1/models", headers={"Origin": ORIGIN})
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == ORIGIN


def test_unknown_origin_gets_no_acao_header(client: TestClient) -> None:
    res = client.get("/api/v1/models", headers={"Origin": "http://evil.example"})
    assert res.status_code == 200
    assert "access-control-allow-origin" not in res.headers


def test_preflight_succeeds_for_allowlisted_origin(client: TestClient) -> None:
    res = client.options(
        "/api/v1/chat",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == ORIGIN
