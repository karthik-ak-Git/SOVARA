"""Provider construction site (Phase 1 / Slice 1).

The ONLY place that instantiates a ModelProvider. Enforces, in order:
1. echo is refused in production (dev harness must never serve prod traffic);
2. non-loopback runtime URLs must pass the NetworkPolicy egress gate
   (loopback is always allowed by the policy itself);
3. the chosen model is registered in the ModelRegistry with a live
   availability probe, so GET /models and the UI show real status.
"""

from __future__ import annotations

from sovara.domain.errors import SecurityPolicyError
from sovara.domain.model_provider import ModelProvider
from sovara.domain.model_registry import ModelRecord, ModelRegistry
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.models.echo_provider import EchoProvider
from sovara.infrastructure.models.ollama.ollama_provider import OllamaProvider
from sovara.infrastructure.security.network_policy import NetworkPolicy


async def build_provider(
    settings: Settings,
    registry: ModelRegistry,
    policy: NetworkPolicy,
) -> ModelProvider:
    kind = settings.model_provider
    if kind == "echo":
        if settings.env == "production":
            raise RuntimeError("SOVARA_MODEL_PROVIDER=echo is refused in production.")
        provider: ModelProvider = EchoProvider(model_id=settings.model_default_id)
    else:
        decision = policy.check_egress(settings.ollama_base_url)
        if not decision.allowed:
            raise SecurityPolicyError(
                f"Ollama egress denied by network policy: {decision.reason} (host={decision.host})"
            )
        provider = OllamaProvider(
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            timeout_s=settings.ollama_timeout_s,
        )

    info = provider.info
    health = await provider.health()
    registry.register(
        ModelRecord(
            model_id=settings.model_default_id,
            provider=info.provider,
            capabilities=info.capabilities,
            resource=info.resource,
            available=health.available,
        )
    )
    return provider
