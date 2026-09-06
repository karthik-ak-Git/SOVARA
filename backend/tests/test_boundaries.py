"""Placeholder boundary tests: contracts exist, real work deferred."""


def test_models_registry_lists_configured_fallback(client) -> None:
    # Default client: LM Studio + Ollama unreachable -> one configured
    # record per runtime, honestly marked unavailable. Routing is auto.
    r = client.get("/api/v1/models")
    assert r.status_code == 200
    body = r.json()
    by_id = {i["id"]: i for i in body["items"]}
    assert set(by_id) == {"llama3.1", "local-model"}
    item = by_id["llama3.1"]
    assert item["provider"] == "ollama"
    assert item["availability"] == "unavailable"
    assert item["capability_source"] == "configured"
    assert body["meta"]["routing"] == "auto"
    assert body["meta"]["default_model_id"] == "llama3.1"


def test_model_detail_and_404(client) -> None:
    r = client.get("/api/v1/models/llama3.1")
    assert r.status_code == 200
    assert r.json()["id"] == "llama3.1"
    missing = client.get("/api/v1/models/ghost")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


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
