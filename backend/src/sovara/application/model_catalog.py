"""Model catalog (Slice 2): discovery orchestration + default resolution.

Owns the refresh lifecycle the gateway depends on but never performs:
- refresh(): discover via the provider, normalize into records, replace the
  registry contents. Empty discovery falls back to one configured record so
  a down runtime shows "known but unavailable" instead of an empty list.
- resolve_default(): explicit override > configured native id > first
  available > first registered > explicit id (unknown → honest 502 later).

Refresh is explicit (startup + POST /models/refresh), never per-chat:
chat turns only read the cached flags.
"""

from __future__ import annotations

from sovara.domain.model_provider import ModelInfo, ModelProvider
from sovara.domain.model_registry import (
    CapabilitySource,
    ModelAvailability,
    ModelRecord,
    ModelRegistry,
)
from sovara.infrastructure.logging.structured import get_logger

log = get_logger("sovara.catalog")


class ModelCatalog:
    def __init__(
        self,
        provider: ModelProvider,
        registry: ModelRegistry,
        *,
        configured_model_id: str,
        configured_source: CapabilitySource = CapabilitySource.CONFIGURED,
    ) -> None:
        self._provider = provider
        self._registry = registry
        self._configured_model_id = configured_model_id
        self._configured_source = configured_source

    async def refresh(self) -> list[ModelRecord]:
        infos = await self._provider.list_models()
        health = await self._provider.health()
        availability = (
            ModelAvailability.AVAILABLE if health.available else ModelAvailability.UNAVAILABLE
        )
        for record in self._registry.list():
            self._registry.remove(record.model_id)
        records = [
            self._record_from(
                info,
                availability,
                CapabilitySource.PROVIDER,
            )
            for info in infos
        ]
        if not records:
            # Runtime lists nothing (down or empty): keep one configured
            # record so the model stays visible with honest availability.
            info = self._provider.info
            records = [
                ModelRecord(
                    model_id=self._configured_model_id,
                    display_name=info.display_name,
                    provider=info.provider,
                    runtime=self._runtime_name(info.provider),
                    version=info.version,
                    capabilities=info.capabilities,
                    capability_source=self._configured_source,
                    context_window=info.resource.context_window,
                    parameter_size_b=info.resource.parameters_b,
                    availability=availability,
                    resource=info.resource,
                )
            ]
        for record in records:
            self._registry.register(record)
        log.info(
            "model catalog refreshed models=%d availability=%s",
            len(records),
            availability.value,
        )
        return records

    def resolve_default(self, preferred: str | None) -> str:
        records = self._registry.list()
        ids = {r.model_id for r in records}
        if preferred and preferred in ids:
            return preferred
        if self._configured_model_id in ids:
            return self._configured_model_id
        for record in records:
            if record.availability == ModelAvailability.AVAILABLE:
                return record.model_id
        if records:
            return records[0].model_id
        return preferred or self._configured_model_id

    @staticmethod
    def _record_from(
        info: ModelInfo,
        availability: ModelAvailability,
        source: CapabilitySource,
    ) -> ModelRecord:
        return ModelRecord(
            model_id=info.model_id,
            display_name=info.display_name,
            provider=info.provider,
            runtime=ModelCatalog._runtime_name(info.provider),
            version=info.version,
            capabilities=info.capabilities,
            capability_source=source,
            context_window=info.resource.context_window,
            parameter_size_b=info.resource.parameters_b,
            availability=availability,
            resource=info.resource,
        )

    @staticmethod
    def _runtime_name(provider: str) -> str:
        return {"ollama": "Ollama", "lmstudio": "LM Studio", "echo": "Dev harness"}.get(
            provider, provider
        )
