"""Provider construction site (Phase 1 / Slice 1, extended Slice 2).

The ONLY place that instantiates a ModelProvider. Enforces, in order:
1. echo is refused in production (dev harness must never serve prod traffic);
2. non-loopback runtime URLs must pass the NetworkPolicy egress gate
   (loopback is always allowed by the policy itself).

Returns (provider, configured_native_model_id). Registration and default
resolution belong to ModelCatalog (Slice 2), not the factory.
"""

from __future__ import annotations

from sovara.domain.errors import SecurityPolicyError
from sovara.domain.model_provider import ModelProvider
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.models.echo_provider import EchoProvider
from sovara.infrastructure.models.lmstudio.lmstudio_provider import LMStudioProvider
from sovara.infrastructure.models.ollama.ollama_provider import OllamaProvider
from sovara.infrastructure.security.network_policy import NetworkPolicy


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
