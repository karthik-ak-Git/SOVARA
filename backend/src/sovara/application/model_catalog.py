"""Model catalog (Slice 3): multi-runtime discovery orchestration.

Owns the refresh lifecycle the gateway depends on but never performs:
- refresh(): per provider — probe connection, discover models, normalize
  into records, replace the registry contents. A down runtime contributes
  one configured record (known-but-unavailable) instead of breaking the
  other runtimes. Empty discovery on a *connected* runtime contributes
  nothing (no models to offer).
- resolve_default(): explicit override > preferred default > configured
  native id > first available > first registered.
- provider_map(): model_id -> serving adapter, rebuilt after every refresh.

Refresh is explicit (startup + POST /models/refresh), never per-chat:
chat turns only read the cached flags.
"""

from __future__ import annotations

from sovara.application.runtime_connections import RuntimeConnectionManager
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
        manager: RuntimeConnectionManager,
        registry: ModelRegistry,
        *,
        configured_model_ids: dict[str, str],
        preferred_default: str | None = None,
        primary_kind: str | None = None,
        configured_source: CapabilitySource = CapabilitySource.CONFIGURED,
    ) -> None:
        self._manager = manager
        self._registry = registry
        self._configured_model_ids = dict(configured_model_ids)
        self._preferred_default = preferred_default
        self._primary_kind = primary_kind
        self._configured_source = configured_source

    @property
    def manager(self) -> RuntimeConnectionManager:
        return self._manager

    async def refresh(self) -> list[ModelRecord]:
        statuses = await self._manager.check_connections()
        connected = {s.provider: s.connected for s in statuses}
        discovered = await self._manager.discover_models()
        for record in self._registry.list():
            self._registry.remove(record.model_id)
        records: list[ModelRecord] = []
        for kind in self._manager.provider_registry.kinds():
            provider = self._manager.provider_registry.get(kind)
            assert provider is not None
            availability = (
                ModelAvailability.AVAILABLE
                if connected.get(kind, False)
                else ModelAvailability.UNAVAILABLE
            )
            infos = discovered.get(kind, [])
            if infos:
                records.extend(
                    self._record_from(info, availability, CapabilitySource.PROVIDER, kind)
                    for info in infos
                )
            elif kind in self._configured_model_ids:
                # Runtime lists nothing (down or empty): keep one configured
                # record so the model stays visible with honest availability.
                info = provider.info
                records.append(
                    ModelRecord(
                        model_id=self._configured_model_ids[kind],
                        display_name=info.display_name,
                        provider=kind,
                        runtime=self._runtime_name(kind),
                        version=info.version,
                        role=info.role,
                        capabilities=info.capabilities,
                        capability_source=self._configured_source,
                        context_window=info.resource.context_window,
                        parameter_size_b=info.resource.parameters_b,
                        availability=availability,
                        resource=info.resource,
                    )
                )
        for record in records:
            self._registry.register(record)
        log.info(
            "model catalog refreshed models=%d availability=%s",
            len(records),
            {k: ("up" if v else "down") for k, v in connected.items()},
        )
        return records

    def provider_map(self) -> dict[str, ModelProvider]:
        """model_id -> serving adapter for every registered record."""
        mapping: dict[str, ModelProvider] = {}
        registry = self._manager.provider_registry
        for record in self._registry.list():
            provider = registry.provider_for_record(record)
            if provider is not None:
                mapping[record.model_id] = provider
        return mapping

    def resolve_default(self, preferred: str | None) -> str:
        records = self._registry.list()
        ids = {r.model_id for r in records}
        if preferred and preferred in ids:
            return preferred
        if self._preferred_default and self._preferred_default in ids:
            return self._preferred_default
        # Primary runtime's native id first (existing deployments keep their
        # default), then other configured natives in stable kind order.
        ordered_kinds = sorted(self._configured_model_ids)
        if self._primary_kind in self._configured_model_ids:
            ordered_kinds.remove(self._primary_kind)
            ordered_kinds.insert(0, self._primary_kind)
        for kind in ordered_kinds:
            native = self._configured_model_ids[kind]
            if native in ids:
                return native
        for record in records:
            if record.availability == ModelAvailability.AVAILABLE:
                return record.model_id
        if records:
            return records[0].model_id
        if preferred:
            return preferred
        return next(iter(self._configured_model_ids.values()), "")

    @staticmethod
    def _record_from(
        info: ModelInfo,
        availability: ModelAvailability,
        source: CapabilitySource,
        kind: str,
    ) -> ModelRecord:
        """Normalize one discovered info. The provider field is stamped with
        the adapter kind the catalog discovered it from (not the adapter's
        self-report), so provider_map() always resolves to a live adapter."""
        return ModelRecord(
            model_id=info.model_id,
            display_name=info.display_name,
            provider=kind,
            runtime=ModelCatalog._runtime_name(kind),
            version=info.version,
            role=info.role,
            capabilities=info.capabilities,
            capability_source=source,
            context_window=info.resource.context_window,
            parameter_size_b=info.resource.parameters_b,
            availability=availability,
            resource=info.resource,
        )

    @staticmethod
    def _runtime_name(provider: str) -> str:
        return RuntimeConnectionManager.runtime_name(provider)
