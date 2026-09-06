"""Model gateway + provider factory tests (Slice 1)."""

from __future__ import annotations

import asyncio

import pytest

from sovara.application.model_gateway import ModelGateway
from sovara.domain.errors import ModelError, SecurityPolicyError
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.models.echo_provider import EchoProvider
from sovara.infrastructure.models.factory import build_provider
from sovara.infrastructure.registries import InMemoryModelRegistry
from sovara.infrastructure.security.network_policy import NetworkPolicy


def _gateway() -> ModelGateway:
    provider = EchoProvider(model_id="echo-dev")
    return ModelGateway(
        registry=InMemoryModelRegistry(),
        providers={"echo-dev": provider},
        default_model_id="echo-dev",
    )


def test_gateway_resolves_default_and_explicit() -> None:
    gw = _gateway()
    assert gw.resolve(None).info.model_id == "echo-dev"
    assert gw.resolve("echo-dev").info.model_id == "echo-dev"


def test_gateway_unknown_model_raises_model_error() -> None:
    gw = _gateway()
    with pytest.raises(ModelError) as exc:
        gw.resolve("ghost")
    assert exc.value.status_code == 502
    assert exc.value.code.value == "model_error"


def test_factory_registers_echo_and_marks_available() -> None:
    settings = Settings(env="test", model_provider="echo", model_default_id="echo-dev")
    registry = InMemoryModelRegistry()
    provider = asyncio.run(build_provider(settings, registry, NetworkPolicy()))
    assert provider.info.provider == "echo"
    record = registry.get("echo-dev")
    assert record is not None and record.available is True


def test_factory_refuses_echo_in_production() -> None:
    settings = Settings(env="production", model_provider="echo")
    with pytest.raises(RuntimeError, match="refused in production"):
        asyncio.run(build_provider(settings, InMemoryModelRegistry(), NetworkPolicy()))


def test_factory_denies_remote_runtime_under_local_only() -> None:
    settings = Settings(
        env="development",
        model_provider="ollama",
        ollama_base_url="http://models.corp.example:11434",
    )
    with pytest.raises(SecurityPolicyError):
        asyncio.run(
            build_provider(settings, InMemoryModelRegistry(), NetworkPolicy(local_only=True))
        )


def test_factory_allows_loopback_runtime() -> None:
    settings = Settings(env="development", model_provider="ollama")
    registry = InMemoryModelRegistry()
    provider = asyncio.run(build_provider(settings, registry, NetworkPolicy(local_only=True)))
    assert provider.info.provider == "ollama"
    assert registry.get(settings.model_default_id) is not None
