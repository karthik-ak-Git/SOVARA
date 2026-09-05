"""Placeholder boundary tests: contracts exist, real work deferred."""


def test_models_empty_list_shape(client) -> None:
    r = client.get("/api/v1/models")
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["meta"]["routing"] == "deferred"


def test_tools_empty_list_shape(client) -> None:
    r = client.get("/api/v1/tools")
    assert r.status_code == 200
    assert r.json()["meta"]["execution"] == "deferred"


def test_task_create_echoes_without_executing(client) -> None:
    r = client.post("/api/v1/tasks", json={"goal": "Summarize Q3 report"})
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "task"
    assert body["echo"]["goal"] == "Summarize Q3 report"
    assert body["status"] == "phase0-placeholder"


def test_knowledge_search_deferred(client) -> None:
    r = client.post("/api/v1/knowledge/search", json={"query": "safety manual"})
    assert r.status_code == 200
    assert r.json()["meta"]["retrieval"] == "deferred"


def test_artifacts_and_audit_deferred(client) -> None:
    assert client.get("/api/v1/artifacts").json()["meta"]["generation"] == "deferred"
    assert client.get("/api/v1/audit/events").json()["meta"]["event_store"] == "deferred"
