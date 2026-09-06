"""Model gateway (Phase 1 / Slice 1).

Thin resolution seam between application services and model providers:
- owns the model_id -> provider mapping (exactly one entry in Slice 1);
- resolves the default when the caller omits model_id;
- raises ModelError("model unavailable") for unknown IDs, never KeyError.

No routing intelligence here (deferred to Phase 2 by design).
"""

from __future__ import annotations

from sovara.domain.errors import ModelError
from sovara.domain.model_provider import ModelProvider
from sovara.domain.model_registry import ModelRegistry


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
        provider = self._providers.get(target)
        if provider is None:
            raise ModelError(f"Model '{target}' is unavailable")
        return provider

    def registered_ids(self) -> list[str]:
        return [r.model_id for r in self._registry.list()]
