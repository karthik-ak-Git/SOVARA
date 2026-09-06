"""Model gateway (Slice 2: multi-model manual selection).

Thin resolution seam between application services and model providers:
- owns the model_id -> provider mapping (one entry per registered model);
- resolves the default when the caller omits model_id;
- distinguishes unknown IDs from known-but-unavailable ones;
- raises ModelError (502) for both, never KeyError.

No routing intelligence here (deferred by design, see ADR-0009).
"""

from __future__ import annotations

from sovara.domain.errors import ModelError
from sovara.domain.model_provider import ModelProvider
from sovara.domain.model_registry import ModelAvailability, ModelRegistry


class ModelGateway:
    def __init__(
        self,
        registry: ModelRegistry,
        providers: dict[str, ModelProvider],
        default_model_id: str,
    ) -> None:
        self._registry = registry
        self._providers = dict(providers)
        self._default_model_id = default_model_id

    @property
    def default_model_id(self) -> str:
        return self._default_model_id

    def resolve(self, model_id: str | None) -> ModelProvider:
        target = model_id or self._default_model_id
        record = self._registry.get(target)
        if record is None:
            raise ModelError(f"Model '{target}' is unknown")
        if record.availability == ModelAvailability.UNAVAILABLE:
            raise ModelError(f"Model '{target}' is unavailable")
        provider = self._providers.get(target)
        if provider is None:
            raise ModelError(f"Model '{target}' is unavailable")
        return provider

    def rebind(self, providers: dict[str, ModelProvider], default_model_id: str) -> None:
        """Sync mapping after a catalog refresh (new/removed record ids)."""
        self._providers = dict(providers)
        self._default_model_id = default_model_id

    def registered_ids(self) -> list[str]:
        return [r.model_id for r in self._registry.list()]
