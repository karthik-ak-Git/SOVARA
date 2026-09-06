"""Model gateway tests (Slice 2: multi-model manual selection)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from sovara.application.model_catalog import ModelCatalog
from sovara.application.model_gateway import ModelGateway
from sovara.application.provider_registry import ProviderRegistry
from sovara.application.runtime_connections import RuntimeConnectionManager
from sovara.domain.errors import ModelError, SecurityPolicyError
from sovara.domain.model_provider import (
    InferenceRequest,
    InferenceResponse,
    ModelHealth,
    ModelInfo,
    ModelProvider,
)
from sovara.domain.model_registry import (
    CapabilitySource,
    ModelAvailability,
    ModelRecord,
    ModelRegistry,
)
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.models.factory import build_provider
from sovara.infrastructure.registries import InMemoryModelRegistry
from sovara.infrastructure.security.network_policy import NetworkPolicy


class _StubProvider(ModelProvider):
    """Minimal provider with a fixed id for dispatch tests."""

    def __init__(self, model_id: str) -> None:
        self._info = ModelInfo(model_id=model_id, provider="stub")

    @property
    def info(self) -> ModelInfo:
        return self._info

    async def health(self) -> ModelHealth:
        return ModelHealth(model_id=self._info.model_id, available=True, detail="stub")

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        return InferenceResponse(model_id=self._info.model_id, text="stub")

    async def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        yield "stub"
        return

    async def list_models(self) -> list[ModelInfo]:
        return [self._info]


def _record(model_id: str, availability: ModelAvailability) -> ModelRecord:
    return ModelRecord(
        model_id=model_id,
        display_name=model_id,
        provider="stub",
        availability=availability,
    )


def _gateway() -> ModelGateway:
    registry = InMemoryModelRegistry()
    registry.register(_record("model-a", ModelAvailability.AVAILABLE))
    registry.register(_record("model-b", ModelAvailability.AVAILABLE))
    return ModelGateway(
        registry=registry,
        providers={"model-a": _StubProvider("model-a"), "model-b": _StubProvider("model-b")},
        default_model_id="model-a",
    )


def test_gateway_resolves_default_and_explicit() -> None:
    gw = _gateway()
    assert gw.resolve(None).info.model_id == "model-a"
    assert gw.resolve("model-b").info.model_id == "model-b"


def test_gateway_dispatches_to_correct_provider() -> None:
    gw = _gateway()
    assert gw.resolve("model-a") is not gw.resolve("model-b")


def test_gateway_unknown_model_raises_model_error() -> None:
    gw = _gateway()
    with pytest.raises(ModelError, match="unknown") as exc:
        gw.resolve("ghost")
    assert exc.value.status_code == 502
    assert exc.value.code.value == "model_error"


def test_gateway_unavailable_model_raises_model_error() -> None:
    registry = InMemoryModelRegistry()
    registry.register(_record("model-down", ModelAvailability.UNAVAILABLE))
    gw = ModelGateway(
        registry=registry,
        providers={"model-down": _StubProvider("model-down")},
        default_model_id="model-down",
    )
    with pytest.raises(ModelError, match="unavailable") as exc:
        gw.resolve("model-down")
    assert exc.value.status_code == 502


def test_gateway_rebind_swaps_mapping() -> None:
    gw = _gateway()
    registry = InMemoryModelRegistry()
    registry.register(_record("model-c", ModelAvailability.AVAILABLE))
    gw = ModelGateway(
        registry=registry,
        providers={"model-a": _StubProvider("model-a")},
        default_model_id="model-a",
    )
    gw.rebind({"model-c": _StubProvider("model-c")}, "model-c")
    assert gw.resolve(None).info.model_id == "model-c"
    with pytest.raises(ModelError):
        gw.resolve("model-a")


def _catalog(
    provider: ModelProvider,
    configured_id: str,
    registry: ModelRegistry | None = None,
) -> ModelCatalog:
    """Single-adapter catalog: the Slice 2 shape on Slice 3 wiring."""
    providers = ProviderRegistry({"stub": provider})
    manager = RuntimeConnectionManager(providers)
    return ModelCatalog(
        manager=manager,
        registry=registry or InMemoryModelRegistry(),
        configured_model_ids={"stub": configured_id},
        primary_kind="stub",
    )


def test_catalog_registers_discovered_models() -> None:
    provider = _StubProvider("ignored")
    catalog = _catalog(provider, "fallback")

    async def fake_list() -> list[ModelInfo]:
        return [
            ModelInfo(model_id="a", display_name="A", provider="stub"),
            ModelInfo(model_id="b", display_name="B", provider="stub"),
        ]

    provider.list_models = fake_list  # type: ignore[method-assign]
    records = asyncio.run(catalog.refresh())
    assert [r.model_id for r in records] == ["a", "b"]
    assert all(r.capability_source == CapabilitySource.PROVIDER for r in records)
    assert all(r.availability == ModelAvailability.AVAILABLE for r in records)
    assert catalog.resolve_default(None) == "a"


def test_catalog_falls_back_to_configured_when_runtime_down() -> None:
    class _Down(_StubProvider):
        async def health(self) -> ModelHealth:
            return ModelHealth(model_id="x", available=False, detail="down")

        async def list_models(self) -> list[ModelInfo]:
            return []

    catalog = _catalog(_Down("x"), "cfg-model")
    records = asyncio.run(catalog.refresh())
    assert [r.model_id for r in records] == ["cfg-model"]
    assert records[0].capability_source == CapabilitySource.CONFIGURED
    assert records[0].availability == ModelAvailability.UNAVAILABLE


def test_catalog_default_prefers_explicit_then_native_then_available() -> None:
    registry = InMemoryModelRegistry()
    registry.register(_record("native-x", ModelAvailability.UNAVAILABLE))
    registry.register(_record("other", ModelAvailability.AVAILABLE))
    catalog = _catalog(_StubProvider("x"), "native-x", registry)
    assert catalog.resolve_default("other") == "other"  # explicit override wins
    assert catalog.resolve_default("ghost") == "native-x"  # native fallback
    registry.remove("native-x")
    assert catalog.resolve_default("ghost") == "other"  # first available


def test_factory_returns_provider_and_native_id() -> None:
    settings = Settings(env="test", model_provider="echo", model_default_id="echo-dev")
    provider, native = asyncio.run(build_provider(settings, NetworkPolicy()))
    assert provider.info.provider == "echo"
    assert native == "echo-dev"


def test_factory_refuses_echo_in_production() -> None:
    settings = Settings(env="production", model_provider="echo")
    with pytest.raises(RuntimeError, match="refused in production"):
        asyncio.run(build_provider(settings, NetworkPolicy()))


def test_factory_denies_remote_runtime_under_local_only() -> None:
    settings = Settings(
        env="development",
        model_provider="ollama",
        ollama_base_url="http://models.corp.example:11434",
    )
    with pytest.raises(SecurityPolicyError):
        asyncio.run(build_provider(settings, NetworkPolicy(local_only=True)))


def test_factory_allows_loopback_runtime() -> None:
    settings = Settings(env="development", model_provider="ollama")
    provider, native = asyncio.run(build_provider(settings, NetworkPolicy(local_only=True)))
    assert provider.info.provider == "ollama"
    assert native == settings.ollama_model


def test_registry_availability_update() -> None:
    registry: ModelRegistry = InMemoryModelRegistry()
    registry.register(_record("m", ModelAvailability.UNKNOWN))
    assert registry.set_availability("m", ModelAvailability.AVAILABLE) is True
    assert registry.get("m") is not None
    assert registry.get("m").availability == ModelAvailability.AVAILABLE  # type: ignore[union-attr]
    assert registry.set_availability("ghost", ModelAvailability.AVAILABLE) is False
