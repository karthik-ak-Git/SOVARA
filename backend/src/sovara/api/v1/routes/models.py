"""Model catalog boundary (Phase 0: registry reads only, no routing/inference)."""

from fastapi import APIRouter, Depends

from sovara.api.deps import get_model_registry
from sovara.domain.errors import NotFoundError
from sovara.domain.model_registry import ModelRecord, ModelRegistry

router = APIRouter(tags=["models"])


@router.get("/models")
def list_models(registry: ModelRegistry = Depends(get_model_registry)) -> dict[str, object]:
    records = registry.list()
    return {
        "items": [r.model_dump() for r in records],
        "meta": {"phase": "phase0-placeholder", "routing": "deferred"},
    }


@router.get("/models/{model_id}", response_model=ModelRecord)
def get_model(model_id: str, registry: ModelRegistry = Depends(get_model_registry)) -> ModelRecord:
    record = registry.get(model_id)
    if record is None:
        raise NotFoundError(f"Model '{model_id}' not found")
    return record
