"""Provider registry (Slice 3): named local-runtime adapters.

SOVARA is never hard-coded around one runtime. Every adapter (LM Studio,
Ollama, echo harness, future runtimes) registers here under its kind and
is looked up by kind or by model record. Provider-specific HTTP stays
inside adapters; this registry only holds instances.
"""

from __future__ import annotations

from sovara.domain.model_provider import ModelProvider
from sovara.domain.model_registry import ModelRecord


class ProviderRegistry:
    """Kind -> adapter instance map. No I/O, no discovery, just ownership."""

    def __init__(self, providers: dict[str, ModelProvider] | None = None) -> None:
        self._providers: dict[str, ModelProvider] = dict(providers or {})

    def register(self, kind: str, provider: ModelProvider) -> None:
        self._providers[kind] = provider

    def get(self, kind: str) -> ModelProvider | None:
        return self._providers.get(kind)

    def all(self) -> dict[str, ModelProvider]:
        return dict(self._providers)

    def kinds(self) -> list[str]:
        return sorted(self._providers)

    def provider_for_record(self, record: ModelRecord) -> ModelProvider | None:
        """Adapter that serves a registry record (matched on record.provider)."""
        return self._providers.get(record.provider)
