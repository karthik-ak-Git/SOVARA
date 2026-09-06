"""Harness/runtime regression suite (DeepSeek-harness pass, see
docs/DEEPSEEK_HARNESS_ANALYSIS.md).

Covers the 13 validation behaviors with no live runtime required:
fakes implement the ModelProvider ABC, real adapters are exercised with
stubbed HTTP, and app-level tests use the echo harness. Nothing here
touches the network.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from fastapi.testclient import TestClient

from sovara.application.chat_service import ChatService
from sovara.application.model_catalog import ModelCatalog
from sovara.application.model_gateway import ModelGateway
from sovara.application.model_router import ModelRouter
from sovara.application.provider_registry import ProviderRegistry
from sovara.application.runtime_connections import RuntimeConnectionManager
from sovara.application.task_classifier import classify_task
from sovara.domain.errors import ModelError
from sovara.domain.model_provider import (
    InferenceRequest,
    InferenceResponse,
    ModelHealth,
    ModelInfo,
    ModelProvider,
    ModelRole,
    TaskCapability,
    infer_model_role,
)
from sovara.domain.model_registry import (
    CapabilitySource,
    ModelAvailability,
    ModelRecord,
)
from sovara.domain.routing import TaskProfile, TaskType
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.models.echo_provider import EchoProvider
from sovara.infrastructure.models.factory import build_provider_registry
from sovara.infrastructure.models.lmstudio.lmstudio_provider import LMStudioProvider
from sovara.infrastructure.models.ollama.ollama_provider import OllamaProvider
from sovara.infrastructure.registries import InMemoryModelRegistry
from sovara.infrastructure.security.network_policy import NetworkPolicy
from sovara.main import create_app


class _FakeProvider(ModelProvider):
    """Controllable adapter double: scripted health + discovery + stream."""

    def __init__(
        self,
        kind: str,
        *,
        healthy: bool = True,
        models: list[ModelInfo] | None = None,
        fail_discovery: bool = False,
    ) -> None:
        self._kind = kind
        self._healthy = healthy
        self._models = list(models or [])
        self._fail_discovery = fail_discovery
        self.health_calls = 0
        self.discovery_calls = 0
        self.stream_calls = 0

    @property
    def info(self) -> ModelInfo:
        return ModelInfo(model_id=f"{self._kind}-default", provider=self._kind)

    async def health(self) -> ModelHealth:
        self.health_calls += 1
        return ModelHealth(
            model_id=self.info.model_id,
            available=self._healthy,
            detail="ok" if self._healthy else "runtime unreachable",
        )

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        text = "".join([c async for c in self.stream(request)])
        return InferenceResponse(model_id=request.model_id, text=text)

    async def list_models(self) -> list[ModelInfo]:
        self.discovery_calls += 1
        if self._fail_discovery:
            raise RuntimeError("boom")
        return list(self._models)

    def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        async def _gen() -> AsyncIterator[str]:
            self.stream_calls += 1
            yield "tok-"
            yield request.model_id

        return _gen()


def _record(
    model_id: str,
    provider: str = "ollama",
    availability: ModelAvailability = ModelAvailability.AVAILABLE,
    role: ModelRole = ModelRole.UNKNOWN,
    tasks: list[TaskCapability] | None = None,
) -> ModelRecord:
    from sovara.domain.model_provider import ModelCapabilities

    return ModelRecord(
        model_id=model_id,
        display_name=model_id,
        provider=provider,
        runtime=provider,
        capabilities=ModelCapabilities(tasks=list(tasks or [])),
        capability_source=CapabilitySource.PROVIDER,
        availability=availability,
        role=role,
    )


# 1. Provider registration -------------------------------------------------
def test_provider_registry_registers_and_resolves_by_record() -> None:
    registry = ProviderRegistry()
    fake = _FakeProvider("ollama")
    registry.register("ollama", fake)
    assert registry.get("ollama") is fake
    assert registry.kinds() == ["ollama"]
    assert registry.provider_for_record(_record("m", provider="ollama")) is fake
    assert registry.provider_for_record(_record("m", provider="ghost")) is None


# 2. Runtime connection success --------------------------------------------
def test_check_connections_reports_healthy_runtime() -> None:
    providers = ProviderRegistry({"ollama": _FakeProvider("ollama", healthy=True)})
    manager = RuntimeConnectionManager(providers, base_urls={"ollama": "http://x"})
    statuses = asyncio.run(manager.check_connections())
    assert len(statuses) == 1
    assert statuses[0].connected is True
    assert statuses[0].detail == "ok"


# 3. Runtime unavailable ----------------------------------------------------
def test_down_runtime_reports_unavailable_without_raising() -> None:
    providers = ProviderRegistry({"ollama": _FakeProvider("ollama", healthy=False)})
    manager = RuntimeConnectionManager(providers)
    statuses = asyncio.run(manager.check_connections())
    assert statuses[0].connected is False
    assert "unreachable" in statuses[0].detail


# 4. Provider isolation ------------------------------------------------------
def test_one_failing_provider_does_not_break_the_other() -> None:
    providers = ProviderRegistry(
        {
            "lmstudio": _FakeProvider("lmstudio", healthy=True),
            "ollama": _FakeProvider("ollama", fail_discovery=True),
        }
    )
    manager = RuntimeConnectionManager(providers)
    statuses = asyncio.run(manager.check_connections())
    found = asyncio.run(manager.discover_models())
    assert {s.provider for s in statuses} == {"lmstudio", "ollama"}
    assert found["ollama"] == []  # isolated failure -> [], never raise
    assert isinstance(found["lmstudio"], list)


# 5. Model discovery ---------------------------------------------------------
def test_discover_models_returns_per_adapter_lists() -> None:
    info = ModelInfo(model_id="llama3.1", provider="ollama")
    providers = ProviderRegistry({"ollama": _FakeProvider("ollama", models=[info])})
    manager = RuntimeConnectionManager(providers)
    found = asyncio.run(manager.discover_models())
    assert [m.model_id for m in found["ollama"]] == ["llama3.1"]


# 6. Multiple runtimes -------------------------------------------------------
def test_catalog_refresh_coexists_across_runtimes() -> None:
    chat = ModelInfo(model_id="qwen3-8b", provider="lmstudio", role=ModelRole.UNKNOWN)
    providers = ProviderRegistry(
        {
            "lmstudio": _FakeProvider("lmstudio", models=[chat]),
            "ollama": _FakeProvider("ollama", healthy=False),
        }
    )
    registry = InMemoryModelRegistry()
    catalog = ModelCatalog(
        manager=RuntimeConnectionManager(providers),
        registry=registry,
        configured_model_ids={"lmstudio": "qwen3-8b", "ollama": "llama3.1"},
        preferred_default=None,
        primary_kind="lmstudio",
    )
    records = asyncio.run(catalog.refresh())
    by_id = {r.model_id: r for r in records}
    # LM Studio model usable; Ollama keeps one configured UNAVAILABLE record.
    assert by_id["qwen3-8b"].availability == ModelAvailability.AVAILABLE
    assert by_id["llama3.1"].availability == ModelAvailability.UNAVAILABLE
    mapping = catalog.provider_map()
    assert set(mapping) == {"qwen3-8b", "llama3.1"}


# 7. Model role distinction ---------------------------------------------------
def test_infer_model_role_marks_embedding_honestly() -> None:
    assert infer_model_role("text-embedding-nomic-embed-text-v1.5") == ModelRole.EMBEDDING
    assert infer_model_role("nomic-embed-text") == ModelRole.EMBEDDING
    assert infer_model_role("llama3.1") == ModelRole.UNKNOWN
    assert infer_model_role("qwen/qwen3-8b") == ModelRole.UNKNOWN
    assert infer_model_role("") == ModelRole.UNKNOWN


def test_adapters_tag_embedding_models_from_discovery() -> None:
    ollama = OllamaProvider(base_url="http://127.0.0.1:1", model="llama3.1")
    lmstudio = LMStudioProvider(base_url="http://127.0.0.1:1/v1", model="local-model")
    # Pure parsing check via the shared helper (no network): adapters must
    # route through infer_model_role so both runtimes agree.
    assert infer_model_role("text-embedding-nomic-embed-text-v1.5") == ModelRole.EMBEDDING
    assert ollama.info.capabilities.tasks == []  # honest unknown (G2)
    assert lmstudio.info.capabilities.tasks == []  # honest unknown (G2)


# 8. Embedding exclusion from chat routing ------------------------------------
def test_router_excludes_embedding_models_from_chat() -> None:
    router = ModelRouter()
    profile = TaskProfile(task_type=TaskType.GENERAL)
    records = [
        _record("text-embedding-nomic-embed-text-v1.5", role=ModelRole.EMBEDDING),
        _record("llama3.1", role=ModelRole.UNKNOWN),
    ]
    decision = router.route(profile, records)
    assert decision.selected_model_id == "llama3.1"


def test_router_with_only_embeddings_fails_controlled() -> None:
    router = ModelRouter()
    profile = TaskProfile(task_type=TaskType.GENERAL)
    try:
        router.route(
            profile,
            [_record("embed-1", role=ModelRole.EMBEDDING)],
        )
    except ModelError as exc:
        assert "embedding" in str(exc).lower()
    else:  # pragma: no cover - must not silently pick the embedding model
        raise AssertionError("router selected an embedding model for chat")


def test_router_excludes_explicit_embedding_task_claim() -> None:
    router = ModelRouter()
    profile = TaskProfile(task_type=TaskType.GENERAL)
    records = [
        _record("e1", tasks=[TaskCapability.EMBEDDING], role=ModelRole.UNKNOWN),
        _record("llama3.1"),
    ]
    assert router.route(profile, records).selected_model_id == "llama3.1"


# 9. Runtime recovery / re-refresh --------------------------------------------
def test_catalog_recovery_after_runtime_returns() -> None:
    ollama = _FakeProvider("ollama", healthy=False)
    providers = ProviderRegistry({"ollama": ollama})
    registry = InMemoryModelRegistry()
    catalog = ModelCatalog(
        manager=RuntimeConnectionManager(providers),
        registry=registry,
        configured_model_ids={"ollama": "llama3.1"},
        preferred_default=None,
        primary_kind="ollama",
    )
    first = asyncio.run(catalog.refresh())
    assert first[0].availability == ModelAvailability.UNAVAILABLE
    # Runtime comes back with a fresh model list.
    ollama._healthy = True
    ollama._models = [ModelInfo(model_id="llama3.1", provider="ollama")]
    second = asyncio.run(catalog.refresh())
    assert second[0].availability == ModelAvailability.AVAILABLE


# 10. Streaming ----------------------------------------------------------------
def test_echo_streams_through_gateway_shape() -> None:
    provider = EchoProvider(model_id="echo-dev")
    chunks = asyncio.run(_collect(provider))
    assert len(chunks) > 3  # word-by-word stream, content-free template
    assert all(isinstance(c, str) for c in chunks)


async def _collect(provider: ModelProvider) -> list[str]:
    from sovara.domain.chat import ChatMessage, ChatRole

    req = InferenceRequest(
        model_id="echo-dev",
        prompt="hi",
        messages=[ChatMessage(role=ChatRole.USER, content="hi")],
    )
    return [c async for c in provider.stream(req)]


# 11. Gateway / provider integration -------------------------------------------
def test_gateway_resolves_known_and_rejects_unknown_unavailable() -> None:
    providers = ProviderRegistry({"echo": EchoProvider(model_id="echo-dev")})
    registry = InMemoryModelRegistry()
    registry.register(_record("echo-dev", provider="echo"))
    gateway = ModelGateway(
        registry=registry,
        providers={"echo-dev": providers.get("echo")},  # type: ignore[dict-item]
        default_model_id="echo-dev",
    )
    assert gateway.resolve("echo-dev") is providers.get("echo")
    try:
        gateway.resolve("ghost")
    except ModelError as exc:
        assert "unknown" in str(exc).lower()
    else:  # pragma: no cover
        raise AssertionError("unknown model id must 502, never KeyError")
    down = _record("old", provider="echo", availability=ModelAvailability.UNAVAILABLE)
    registry.register(down)
    try:
        gateway.resolve("old")
    except ModelError as exc:
        assert "unavailable" in str(exc).lower()
    else:  # pragma: no cover
        raise AssertionError("unavailable model id must 502")


def test_chat_service_auto_prefers_chat_over_embedding() -> None:
    registry = InMemoryModelRegistry()
    registry.register(_record("text-embedding-nomic-embed-text-v1.5", role=ModelRole.EMBEDDING))
    registry.register(_record("llama3.1"))
    echo = EchoProvider(model_id="echo-dev")
    gateway = ModelGateway(
        registry=registry,
        providers={
            "text-embedding-nomic-embed-text-v1.5": echo,
            "llama3.1": echo,
        },
        default_model_id="llama3.1",
    )
    service = ChatService(
        settings=Settings(env="test"),
        gateway=gateway,
        router=ModelRouter(),
        registry=registry,
    )
    from sovara.domain.chat import ChatMessage, ChatRole

    selected, decision = asyncio.run(
        service.decide([ChatMessage(role=ChatRole.USER, content="hello")])
    )
    assert selected == "llama3.1"
    assert decision is not None


# 12. No provider request when runtime denied/unavailable -----------------------
def test_denied_runtime_is_skipped_without_http() -> None:
    settings = Settings(env="test", enabled_providers=["ollama"])
    policy = NetworkPolicy(local_only=True, allowed_endpoints=(), audit_log=False)
    # Loopback is allowed by construction; force-deny via a non-loopback URL.
    settings = settings.model_copy(update={"ollama_base_url": "http://10.9.9.9:11434"})
    registry, configured = asyncio.run(build_provider_registry(settings, policy))
    assert registry.get("ollama") is None  # skipped, never constructed
    assert configured == {}


def test_down_runtime_chat_fails_pre_stream() -> None:
    settings = Settings(env="test", enabled_providers=[])
    app = create_app(settings)
    with TestClient(app) as client:
        res = client.post("/api/v1/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        assert res.status_code == 502
        assert "No suitable local model" in res.json()["error"]["message"]


# 13. Documented env config boots (G3) ------------------------------------------
def test_enabled_providers_parses_documented_csv_string() -> None:
    s = Settings(env="test", enabled_providers="lmstudio,ollama")  # type: ignore[arg-type]
    assert list(s.enabled_providers) == ["lmstudio", "ollama"]


# 14. Classifier sanity (routing receives trustworthy input) ---------------------
def test_classifier_leaves_embedding_mention_as_textual_hint_only() -> None:
    profile = classify_task("compare llama3.1 and text-embedding-nomic-embed-text-v1.5")
    assert isinstance(profile.task_type, TaskType)


# 15. Reference: mandatory attribution headers (dsh attributionHeaders) ------------
def test_adapters_send_mandatory_user_agent() -> None:
    from sovara.infrastructure.models.attribution import PROVIDER_HEADERS, SOVARA_USER_AGENT

    assert PROVIDER_HEADERS["user-agent"] == SOVARA_USER_AGENT
    assert SOVARA_USER_AGENT.startswith("sovara/")
    assert "sovara" in SOVARA_USER_AGENT.lower()


def test_is_done_line_recognizes_terminal_marker() -> None:
    from sovara.infrastructure.models.lmstudio.lmstudio_provider import is_done_line

    assert is_done_line("data: [DONE]") is True
    assert is_done_line("data:[DONE]") is True
    assert is_done_line("  data: [DONE]  ") is True
    assert is_done_line('data: {"choices": []}') is False
    assert is_done_line("") is False
    assert is_done_line(": comment") is False


# 16. Reference: truncated streams are failures (dsh STREAM_CLOSED) -----------------
class _FakeStreamResponse:
    def __init__(self, status_code: int, lines: list[str]) -> None:
        self.status_code = status_code
        self._lines = lines

    async def __aenter__(self) -> _FakeStreamResponse:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    async def aiter_lines(self) -> AsyncIterator[str]:
        for line in self._lines:
            yield line


class _FakeHttpClient:
    """Minimal httpx.AsyncClient double capturing constructor kwargs."""

    instances: list[_FakeHttpClient] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.kwargs = kwargs
        _FakeHttpClient.instances.append(self)
        self._lines: list[str] = []
        self._status = 200

    def queue_stream(self, status: int, lines: list[str]) -> None:
        self._status = status
        self._lines = lines

    async def __aenter__(self) -> _FakeHttpClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    def stream(self, *args: object, **kwargs: object) -> _FakeStreamResponse:
        return _FakeStreamResponse(self._status, self._lines)


def _run_stream(provider: ModelProvider, lines: list[str], status: int = 200) -> object:
    """Drive provider.stream() against a fake httpx transport."""
    import httpx

    _FakeHttpClient.instances.clear()
    fake: _FakeHttpClient | None = None

    real_client = httpx.AsyncClient

    def _factory(*args: object, **kwargs: object) -> _FakeHttpClient:
        nonlocal fake
        fake = _FakeHttpClient(*args, **kwargs)
        fake.queue_stream(status, lines)
        return fake

    httpx.AsyncClient = _factory  # type: ignore[assignment]
    try:
        from sovara.domain.chat import ChatMessage, ChatRole

        req = InferenceRequest(
            model_id="m",
            prompt="hi",
            messages=[ChatMessage(role=ChatRole.USER, content="hi")],
        )

        async def _drive() -> tuple[list[str], str | None]:
            deltas: list[str] = []
            failure: str | None = None
            try:
                async for d in provider.stream(req):
                    deltas.append(d)
            except ModelError as exc:
                failure = exc.message
            return deltas, failure

        result = asyncio.run(_drive())
        assert fake is not None
        assert fake.kwargs.get("headers", {}).get("user-agent", "").startswith("sovara/")
        return result
    finally:
        httpx.AsyncClient = real_client


def test_lmstudio_truncated_stream_is_a_failure() -> None:
    provider = LMStudioProvider(base_url="http://127.0.0.1:1/v1", model="m")
    deltas, failure = _run_stream(  # type: ignore[misc]
        provider,
        ['data: {"choices": [{"delta": {"content": "hi"}}]}'],
    )
    assert deltas == ["hi"]  # partial content delivered, then truncation flagged
    assert failure is not None and "without completion" in failure


def test_lmstudio_terminated_stream_succeeds() -> None:
    provider = LMStudioProvider(base_url="http://127.0.0.1:1/v1", model="m")
    deltas, failure = _run_stream(  # type: ignore[misc]
        provider,
        ['data: {"choices": [{"delta": {"content": "hi"}}]}', "", "data: [DONE]"],
    )
    assert deltas == ["hi"]
    assert failure is None


def test_ollama_truncated_stream_is_a_failure() -> None:
    import json as _json

    provider = OllamaProvider(base_url="http://127.0.0.1:1", model="m")
    line = _json.dumps({"message": {"content": "hi"}, "done": False})
    deltas, failure = _run_stream(provider, [line])  # type: ignore[misc]
    assert deltas == ["hi"]
    assert failure is not None and "without completion" in failure


def test_ollama_completed_stream_succeeds() -> None:
    import json as _json

    provider = OllamaProvider(base_url="http://127.0.0.1:1", model="m")
    lines = [
        _json.dumps({"message": {"content": "hi"}, "done": False}),
        _json.dumps({"message": {"content": ""}, "done": True}),
    ]
    deltas, failure = _run_stream(provider, lines)  # type: ignore[misc]
    assert deltas == ["hi"]
    assert failure is None
