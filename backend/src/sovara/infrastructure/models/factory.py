"""Provider construction site (Phase 1 / Slice 1, extended Slice 2+3).

The ONLY place that instantiates a ModelProvider. Enforces, in order:
1. echo is refused in production (dev harness must never serve prod traffic);
2. non-loopback runtime URLs must pass the NetworkPolicy egress gate
   (loopback is always allowed by the policy itself).

build_provider() keeps the legacy single-provider path.
build_provider_registry() builds every enabled local runtime so LM Studio,
Ollama (and the echo harness in dev) coexist; a denied or failing runtime
is skipped without breaking the others. Registration and default
resolution belong to ModelCatalog (Slice 2), not the factory.
"""

from __future__ import annotations

from sovara.application.provider_registry import ProviderRegistry
from sovara.domain.errors import SecurityPolicyError
from sovara.domain.model_provider import ModelProvider
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.logging.structured import get_logger
from sovara.infrastructure.models.echo_provider import EchoProvider
from sovara.infrastructure.models.lmstudio.lmstudio_provider import LMStudioProvider
from sovara.infrastructure.models.ollama.ollama_provider import OllamaProvider
from sovara.infrastructure.security.network_policy import NetworkPolicy

log = get_logger("sovara.models.factory")


async def build_provider(
    settings: Settings,
    policy: NetworkPolicy,
) -> tuple[ModelProvider, str]:
    kind = settings.model_provider
    if kind == "echo":
        if settings.env == "production":
            raise RuntimeError("SOVARA_MODEL_PROVIDER=echo is refused in production.")
        return EchoProvider(model_id=settings.model_default_id), settings.model_default_id
    else:
        if kind == "lmstudio":
            runtime = "LM Studio"
            base_url = settings.lmstudio_base_url
            model = settings.lmstudio_model
            timeout_s = settings.lmstudio_timeout_s
        else:
            runtime = "Ollama"
            base_url = settings.ollama_base_url
            model = settings.ollama_model
            timeout_s = settings.ollama_timeout_s
        decision = policy.check_egress(base_url)
        if not decision.allowed:
            raise SecurityPolicyError(
                f"{runtime} egress denied by network policy: {decision.reason} "
                f"(host={decision.host})"
            )
        provider = (
            LMStudioProvider(base_url=base_url, model=model, timeout_s=timeout_s)
            if kind == "lmstudio"
            else OllamaProvider(base_url=base_url, model=model, timeout_s=timeout_s)
        )
        return provider, model


def _runtime_config(settings: Settings, kind: str) -> tuple[str, str, str, float]:
    """(display name, base URL, native model id, timeout) per runtime kind."""
    if kind == "lmstudio":
        return (
            "LM Studio",
            settings.lmstudio_base_url,
            settings.lmstudio_model,
            settings.lmstudio_timeout_s,
        )
    return (
        "Ollama",
        settings.ollama_base_url,
        settings.ollama_model,
        settings.ollama_timeout_s,
    )


async def build_provider_registry(
    settings: Settings,
    policy: NetworkPolicy,
) -> tuple[ProviderRegistry, dict[str, str]]:
    """Build every enabled local runtime; skip denied ones without failing.

    Returns (registry, configured native model id per kind). Echo joins
    automatically when MODEL_PROVIDER=echo outside production; it is
    refused in production exactly like the single-provider path.
    """
    kinds = [k.strip().lower() for k in settings.enabled_providers if k.strip()]
    if settings.model_provider == "echo" and "echo" not in kinds:
        kinds.append("echo")
    registry = ProviderRegistry()
    configured: dict[str, str] = {}
    for kind in kinds:
        if kind == "echo":
            if settings.env == "production":
                raise RuntimeError("SOVARA_MODEL_PROVIDER=echo is refused in production.")
            registry.register(kind, EchoProvider(model_id=settings.model_default_id))
            configured[kind] = settings.model_default_id
            continue
        if kind not in ("lmstudio", "ollama"):
            log.warning("unknown model provider skipped provider=%s", kind)
            continue
        runtime, base_url, model, timeout_s = _runtime_config(settings, kind)
        decision = policy.check_egress(base_url)
        if not decision.allowed:
            # Air-gap boundary holds: a denied runtime is skipped, never
            # connected, and never breaks the remaining runtimes.
            log.warning(
                "runtime skipped by network policy provider=%s reason=%s host=%s",
                kind,
                decision.reason,
                decision.host,
            )
            continue
        provider = (
            LMStudioProvider(base_url=base_url, model=model, timeout_s=timeout_s)
            if kind == "lmstudio"
            else OllamaProvider(base_url=base_url, model=model, timeout_s=timeout_s)
        )
        registry.register(kind, provider)
        configured[kind] = model
    return registry, configured


def runtime_base_urls(settings: Settings) -> dict[str, str]:
    """Configured base URL per runtime kind (status display; no credentials)."""
    return {
        "lmstudio": settings.lmstudio_base_url,
        "ollama": settings.ollama_base_url,
        "echo": "in-process",
    }
