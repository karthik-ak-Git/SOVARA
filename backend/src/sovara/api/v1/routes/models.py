"""Model catalog boundary (Slice 3: normalized records + multi-runtime refresh).

GET /models returns the registry contents in SOVARA-normalized form plus
the resolved default in meta. POST /models/refresh re-runs discovery and
health probes across every enabled runtime (explicit lifecycle — chat
turns never pay this cost). Manual selection stays; meta.routing reports
whether deterministic auto-routing ("auto") is enabled.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from sovara.api.deps import (
    get_model_catalog,
    get_model_gateway,
    get_model_registry,
    get_settings,
)
from sovara.application.model_catalog import ModelCatalog
from sovara.application.model_gateway import ModelGateway
from sovara.application.model_router import ModelRouter
from sovara.domain.errors import NotFoundError
from sovara.domain.model_registry import ModelRecord, ModelRegistry
from sovara.infrastructure.config.settings import Settings

router = APIRouter(tags=["models"])


def record_to_item(record: ModelRecord) -> dict[str, object]:
    return {
        "id": record.model_id,
        "display_name": record.label,
        "provider": record.provider,
        "runtime": record.runtime,
        "version": record.version,
        "capabilities": record.capabilities.model_dump(),
        "capability_source": record.capability_source.value,
        "context_window": record.context_window,
        "parameter_size_b": record.parameter_size_b,
        "availability": record.availability.value,
        "metadata": record.metadata,
    }


def _collection(
    registry: ModelRegistry, gateway: ModelGateway, settings: Settings
) -> dict[str, object]:
    return {
        "items": [record_to_item(r) for r in registry.list()],
        "meta": {
            "routing": "auto" if settings.routing_enabled else "deferred",
            "source": "registry",
            "default_model_id": gateway.default_model_id,
        },
    }


@router.get("/models")
def list_models(
    registry: ModelRegistry = Depends(get_model_registry),
    gateway: ModelGateway = Depends(get_model_gateway),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    return _collection(registry, gateway, settings)


@router.get("/models/{model_id}")
def get_model(
    model_id: str,
    registry: ModelRegistry = Depends(get_model_registry),
) -> dict[str, object]:
    record = registry.get(model_id)
    if record is None:
        raise NotFoundError(f"Model '{model_id}' not found")
    return record_to_item(record)


@router.post("/models/refresh")
async def refresh_models(
    request: Request,
    catalog: ModelCatalog = Depends(get_model_catalog),
    registry: ModelRegistry = Depends(get_model_registry),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> dict[str, object]:
    await catalog.refresh()
    gateway.rebind(
        catalog.provider_map(),
        catalog.resolve_default(gateway.default_model_id),
    )
    router_service: ModelRouter = request.app.state.router
    router_service.rebind(gateway.default_model_id)
    settings: Settings = request.app.state.settings
    return _collection(registry, gateway, settings)
