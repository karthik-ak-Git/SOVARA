"""Slice 3 tests: deterministic task classification + smart model routing.

Covers the spec's routing test plan: classifier types (incl. ambiguous),
capability matching, scoring (context fit, unavailability exclusion,
tie-breaking, determinism), router decisions with reasons, manual
override, auto mode, and chat integration (router chooses, gateway
executes, provider receives the chosen id).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from sovara.application.chat_service import ChatService
from sovara.application.model_catalog import ModelCatalog
from sovara.application.model_gateway import ModelGateway
from sovara.application.model_router import ModelRouter
from sovara.application.provider_registry import ProviderRegistry
from sovara.application.runtime_connections import RuntimeConnectionManager
from sovara.application.task_classifier import classify_task
from sovara.domain.chat import ChatMessage, ChatRole
from sovara.domain.errors import ModelError
from sovara.domain.model_provider import (
    InferenceRequest,
    InferenceResponse,
    Modality,
    ModelCapabilities,
    ModelHealth,
    ModelInfo,
    ModelProvider,
    ModelResource,
    TaskCapability,
)
from sovara.domain.model_registry import ModelAvailability, ModelRecord
from sovara.domain.routing import SelectionMode, TaskType
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.registries import InMemoryModelRegistry


def _msg(text: str) -> list[ChatMessage]:
    return [ChatMessage(role=ChatRole.USER, content=text)]


def _record(
    model_id: str,
    tasks: list[TaskCapability],
    availability: ModelAvailability = ModelAvailability.AVAILABLE,
    *,
    provider: str = "stub",
    modalities: list[Modality] | None = None,
    context_window: int | None = None,
) -> ModelRecord:
    return ModelRecord(
        model_id=model_id,
        display_name=model_id,
        provider=provider,
        runtime="Stub",
        capabilities=ModelCapabilities(
            modalities=modalities if modalities is not None else [Modality.TEXT],
            tasks=tasks,
        ),
        context_window=context_window,
        availability=availability,
    )


# ---------------------------------------------------------------------------
# Task classifier
# ---------------------------------------------------------------------------


def test_classifier_coding() -> None:
    assert classify_task("Write a Python function to parse this CSV").task_type == TaskType.CODING


def test_classifier_reasoning() -> None:
    profile = classify_task("Explain why this calculation is incorrect")
    assert profile.task_type == TaskType.REASONING
    assert profile.required_tasks == [TaskCapability.REASONING]


def test_classifier_document() -> None:
    assert classify_task("Summarize this report").task_type == TaskType.DOCUMENT


def test_classifier_vision() -> None:
    profile = classify_task("Analyze this image")
    assert profile.task_type == TaskType.VISION
    assert Modality.IMAGE in profile.modalities


def test_classifier_data() -> None:
    assert classify_task("Create a comparison of these numbers").task_type == TaskType.DATA


def test_classifier_ambiguous_falls_back_to_general() -> None:
    profile = classify_task("Hello there")
    assert profile.task_type == TaskType.GENERAL
    assert profile.required_tasks == []


def test_classifier_explicit_hint_wins() -> None:
    profile = classify_task("Hello there", task_hint="coding")
    assert profile.task_type == TaskType.CODING
    assert profile.profile_source == "explicit"


def test_classifier_unknown_hint_falls_through() -> None:
    profile = classify_task("Write a Python function", task_hint="nonsense")
    assert profile.task_type == TaskType.CODING


def test_classifier_image_modality_forces_vision() -> None:
    profile = classify_task("What is this?", has_image=True)
    assert profile.task_type == TaskType.VISION


# ---------------------------------------------------------------------------
# Capability matching + scoring
# ---------------------------------------------------------------------------


def _router(configured: str | None = None) -> ModelRouter:
    return ModelRouter(configured_model_id=configured)


def test_router_coding_task_selects_coding_model() -> None:
    records = [
        _record("general-9b", [TaskCapability.REASONING]),
        _record("coder-7b", [TaskCapability.CODING, TaskCapability.REASONING]),
    ]
    decision = _router().route(classify_task("Write a Python function"), records)
    assert decision.selected_model_id == "coder-7b"
    assert "coding_capability" in decision.reason_codes
    assert decision.decision_source == "deterministic_router"


def test_router_vision_task_selects_vision_model() -> None:
    records = [
        _record("coder-7b", [TaskCapability.CODING]),
        _record(
            "seer-4b",
            [TaskCapability.VISION],
            modalities=[Modality.TEXT, Modality.IMAGE],
        ),
    ]
    decision = _router().route(classify_task("Analyze this image"), records)
    assert decision.selected_model_id == "seer-4b"


def test_router_reasoning_task_selects_reasoning_model() -> None:
    records = [
        _record("coder-7b", [TaskCapability.CODING]),
        _record("thinker-9b", [TaskCapability.REASONING]),
    ]
    decision = _router().route(classify_task("Explain why this is wrong"), records)
    assert decision.selected_model_id == "thinker-9b"


def test_router_excludes_unavailable_models() -> None:
    records = [
        _record("coder-7b", [TaskCapability.CODING], ModelAvailability.UNAVAILABLE),
        _record("coder-small", [TaskCapability.CODING]),
    ]
    decision = _router().route(classify_task("Write a Python function"), records)
    assert decision.selected_model_id == "coder-small"


def test_router_errors_when_nothing_available() -> None:
    records = [_record("coder-7b", [TaskCapability.CODING], ModelAvailability.UNAVAILABLE)]
    with pytest.raises(ModelError, match="No suitable local model"):
        _router().route(classify_task("Write a Python function"), records)


def test_router_excludes_known_capability_mismatch() -> None:
    # Only a vision-claiming model for a coding task: controlled error,
    # never a silent misroute.
    records = [_record("seer-4b", [TaskCapability.VISION])]
    with pytest.raises(ModelError, match="No suitable local model"):
        _router().route(classify_task("Write a Python function"), records)


def test_router_unknown_capabilities_serve_as_fallback() -> None:
    # Real discovery often reports no tasks (honest unknowns): eligible,
    # but ranked below a model that claims the required capability.
    records = [
        _record("mystery-9b", []),
        _record("coder-7b", [TaskCapability.CODING]),
    ]
    decision = _router().route(classify_task("Write a Python function"), records)
    assert decision.selected_model_id == "coder-7b"
    # ... yet the unknown model alone is better than no model at all.
    solo = _router().route(classify_task("Write a Python function"), records[:1])
    assert solo.selected_model_id == "mystery-9b"
    assert "capabilities_unknown" in solo.reason_codes


def test_router_rejects_context_overflow() -> None:
    records = [_record("tiny-1b", [TaskCapability.REASONING], context_window=10)]
    profile = classify_task("Explain why this calculation with many details is incorrect " * 10)
    assert profile.context_chars > 10
    with pytest.raises(ModelError, match="No suitable local model"):
        _router().route(profile, records)


def test_router_tie_break_is_deterministic() -> None:
    records = [
        _record("zebra-7b", [TaskCapability.CODING]),
        _record("alpha-7b", [TaskCapability.CODING]),
    ]
    first = _router().route(classify_task("Write a Python function"), records)
    second = _router().route(classify_task("Write a Python function"), list(reversed(records)))
    assert first.selected_model_id == second.selected_model_id == "alpha-7b"


def test_router_configured_default_wins_ties() -> None:
    records = [
        _record("alpha-7b", [TaskCapability.CODING]),
        _record("beta-7b", [TaskCapability.CODING]),
    ]
    decision = _router("beta-7b").route(classify_task("Write a Python function"), records)
    assert decision.selected_model_id == "beta-7b"
    assert "configured_default" in decision.reason_codes


def test_router_decision_lists_scored_candidates() -> None:
    records = [
        _record("coder-7b", [TaskCapability.CODING, TaskCapability.REASONING]),
        _record("mystery-9b", []),
    ]
    decision = _router().route(classify_task("Write a Python function"), records)
    by_id = {c.model_id: c for c in decision.candidates}
    assert set(by_id) == {"coder-7b", "mystery-9b"}
    assert by_id["coder-7b"].score > by_id["mystery-9b"].score


# ---------------------------------------------------------------------------
# Manual override vs auto (ChatService.decide)
# ---------------------------------------------------------------------------


class _StubProvider(ModelProvider):
    def __init__(self, model_id: str, tasks: list[TaskCapability] | None = None) -> None:
        self._info = ModelInfo(
            model_id=model_id,
            provider="stub",
            capabilities=ModelCapabilities(
                modalities=[Modality.TEXT],
                tasks=tasks if tasks is not None else [TaskCapability.REASONING],
            ),
        )
        self.seen: list[str] = []

    @property
    def info(self) -> ModelInfo:
        return self._info

    async def health(self) -> ModelHealth:
        return ModelHealth(model_id=self._info.model_id, available=True, detail="stub")

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        return InferenceResponse(model_id=request.model_id, text="stub")

    async def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        self.seen.append(request.model_id)
        yield "stub"
        return

    async def list_models(self) -> list[ModelInfo]:
        return [self._info]


def _service(
    records: list[ModelRecord],
    providers: dict[str, ModelProvider],
    default: str,
    *,
    routing_enabled: bool = True,
) -> ChatService:
    registry = InMemoryModelRegistry()
    for record in records:
        registry.register(record)
    gateway = ModelGateway(registry=registry, providers=providers, default_model_id=default)
    settings = Settings(env="test", routing_enabled=routing_enabled)
    return ChatService(
        settings=settings,
        gateway=gateway,
        router=ModelRouter(configured_model_id=default),
        registry=registry,
    )


def test_manual_selection_bypasses_router() -> None:
    coder = _StubProvider("coder-7b", [TaskCapability.CODING])
    thinker = _StubProvider("thinker-9b", [TaskCapability.REASONING])
    service = _service(
        [
            _record("coder-7b", [TaskCapability.CODING]),
            _record("thinker-9b", [TaskCapability.REASONING]),
        ],
        {"coder-7b": coder, "thinker-9b": thinker},
        "thinker-9b",
    )
    # General text would route to either; the explicit pick must survive.
    resolved, decision = asyncio.run(
        service.decide(_msg("Hello there"), "coder-7b", selection_mode=SelectionMode.MANUAL)
    )
    assert resolved == "coder-7b"
    assert decision is None


def test_manual_implied_by_explicit_id() -> None:
    coder = _StubProvider("coder-7b", [TaskCapability.CODING])
    service = _service(
        [_record("coder-7b", [TaskCapability.CODING])], {"coder-7b": coder}, "coder-7b"
    )
    resolved, decision = asyncio.run(service.decide(_msg("Hello there"), "coder-7b"))
    assert (resolved, decision) == ("coder-7b", None)


def test_auto_routes_coding_prompt_to_coding_model() -> None:
    coder = _StubProvider("coder-7b", [TaskCapability.CODING])
    thinker = _StubProvider("thinker-9b", [TaskCapability.REASONING])
    service = _service(
        [
            _record("coder-7b", [TaskCapability.CODING]),
            _record("thinker-9b", [TaskCapability.REASONING]),
        ],
        {"coder-7b": coder, "thinker-9b": thinker},
        "thinker-9b",
    )
    resolved, decision = asyncio.run(
        service.decide(_msg("Write a Python function"), selection_mode=SelectionMode.AUTO)
    )
    assert resolved == "coder-7b"
    assert decision is not None
    assert decision.task_type == TaskType.CODING


def test_auto_ignores_model_id_hint() -> None:
    coder = _StubProvider("coder-7b", [TaskCapability.CODING])
    thinker = _StubProvider("thinker-9b", [TaskCapability.REASONING])
    service = _service(
        [
            _record("coder-7b", [TaskCapability.CODING]),
            _record("thinker-9b", [TaskCapability.REASONING]),
        ],
        {"coder-7b": coder, "thinker-9b": thinker},
        "thinker-9b",
    )
    resolved, _ = asyncio.run(
        service.decide(
            _msg("Write a Python function"), "thinker-9b", selection_mode=SelectionMode.AUTO
        )
    )
    assert resolved == "coder-7b"


def test_auto_disabled_falls_back_to_default() -> None:
    coder = _StubProvider("coder-7b", [TaskCapability.CODING])
    service = _service(
        [_record("coder-7b", [TaskCapability.CODING])],
        {"coder-7b": coder},
        "coder-7b",
        routing_enabled=False,
    )
    resolved, decision = asyncio.run(service.decide(_msg("Write a Python function")))
    assert (resolved, decision) == ("coder-7b", None)


def test_chat_integration_gateway_receives_routed_model() -> None:
    """Auto -> router selects -> gateway executes -> provider sees the id."""
    coder = _StubProvider("coder-7b", [TaskCapability.CODING])
    thinker = _StubProvider("thinker-9b", [TaskCapability.REASONING])
    service = _service(
        [
            _record("coder-7b", [TaskCapability.CODING]),
            _record("thinker-9b", [TaskCapability.REASONING]),
        ],
        {"coder-7b": coder, "thinker-9b": thinker},
        "thinker-9b",
    )

    async def go() -> None:
        resolved, _ = await service.decide(
            _msg("Write a Python function"), selection_mode=SelectionMode.AUTO
        )
        async for _ in service.stream_chat(_msg("Write a Python function"), resolved):
            pass

    asyncio.run(go())
    assert coder.seen == ["coder-7b"]
    assert thinker.seen == []


# ---------------------------------------------------------------------------
# Connection manager: multi-provider coexistence + failure isolation
# ---------------------------------------------------------------------------


class _DownProvider(_StubProvider):
    async def health(self) -> ModelHealth:
        return ModelHealth(model_id=self._info.model_id, available=False, detail="down")

    async def list_models(self) -> list[ModelInfo]:
        return []


def test_connection_manager_reports_per_provider_status() -> None:
    manager = RuntimeConnectionManager(
        ProviderRegistry({"up": _StubProvider("a"), "down": _DownProvider("b")})
    )
    statuses = asyncio.run(manager.check_connections())
    by_kind = {s.provider: s for s in statuses}
    assert by_kind["up"].connected is True
    assert by_kind["down"].connected is False


def test_connection_manager_isolates_discovery_failure() -> None:
    class _Exploding(_StubProvider):
        async def list_models(self) -> list[ModelInfo]:
            raise RuntimeError("boom")

    manager = RuntimeConnectionManager(
        ProviderRegistry({"bad": _Exploding("x"), "good": _StubProvider("y")})
    )
    found = asyncio.run(manager.discover_models())
    assert found["bad"] == []
    assert [i.model_id for i in found["good"]] == ["y"]


def test_catalog_refresh_coexists_across_providers() -> None:
    providers = ProviderRegistry({"alpha": _StubProvider("a"), "beta": _DownProvider("b")})
    manager = RuntimeConnectionManager(providers)
    registry = InMemoryModelRegistry()
    catalog = ModelCatalog(
        manager=manager,
        registry=registry,
        configured_model_ids={"alpha": "a", "beta": "b"},
    )
    records = asyncio.run(catalog.refresh())
    by_id = {r.model_id: r for r in records}
    assert by_id["a"].availability == ModelAvailability.AVAILABLE
    assert by_id["b"].availability == ModelAvailability.UNAVAILABLE
    # Gateway map points each record at its own adapter.
    mapping = catalog.provider_map()
    assert isinstance(mapping["a"], _StubProvider)
    assert isinstance(mapping["b"], _DownProvider)


def test_provider_registry_lookup() -> None:
    provider = _StubProvider("a")
    registry = ProviderRegistry({"stub": provider})
    assert registry.get("stub") is provider
    assert registry.get("ghost") is None
    assert registry.kinds() == ["stub"]
    record = _record("a", [TaskCapability.REASONING], provider="stub")
    assert registry.provider_for_record(record) is provider


def test_model_resource_defaults() -> None:
    info = ModelInfo(model_id="x", provider="stub")
    assert info.resource == ModelResource()
