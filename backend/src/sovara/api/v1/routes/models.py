"""Model catalog boundary (Slice 2: normalized records + refresh).

GET /models returns the registry contents in SOVARA-normalized form plus
the resolved default in meta. POST /models/refresh re-runs discovery and
health probes (explicit lifecycle — chat turns never pay this cost).
Routing stays deferred; the selector is manual.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from sovara.api.deps import (
    get_model_catalog,
    get_model_gateway,
    get_model_registry,
)
from sovara.application.model_catalog import ModelCatalog
from sovara.application.model_gateway import ModelGateway
from sovara.domain.errors import NotFoundError
from sovara.domain.model_provider import ModelProvider
from sovara.domain.model_registry import ModelRecord, ModelRegistry

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


def _collection(registry: ModelRegistry, gateway: ModelGateway) -> dict[str, object]:
    return {
        "items": [record_to_item(r) for r in registry.list()],
        "meta": {
            "routing": "deferred",
            "source": "registry",
            "default_model_id": gateway.default_model_id,
        },
    }


@router.get("/models")
def list_models(
    registry: ModelRegistry = Depends(get_model_registry),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> dict[str, object]:
    return _collection(registry, gateway)


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
    records = await catalog.refresh()
    provider: ModelProvider = request.app.state.provider
    gateway.rebind(
        {r.model_id: provider for r in records},
        catalog.resolve_default(gateway.default_model_id),
    )
    return _collection(registry, gateway)
