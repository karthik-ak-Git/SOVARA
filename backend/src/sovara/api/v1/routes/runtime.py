"""Local runtime connection boundary (Slice 3, Part A).

GET /providers reports each configured runtime's connection state
separately from model availability: a provider can be down while its
models stay registered, and vice versa. Counts only — no prompts,
no responses, no credentials.
"""

from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends

from sovara.api.deps import get_connection_manager, get_model_registry
from sovara.application.runtime_connections import RuntimeConnectionManager
from sovara.domain.model_registry import ModelRegistry

router = APIRouter(tags=["runtime"])


@router.get("/providers")
async def list_providers(
    manager: RuntimeConnectionManager = Depends(get_connection_manager),
    registry: ModelRegistry = Depends(get_model_registry),
) -> dict[str, object]:
    counts = Counter(r.provider for r in registry.list())
    statuses = await manager.check_connections()
    items = [
        {
            "provider": s.provider,
            "runtime": s.runtime,
            "base_url": s.base_url,
            "connected": s.connected,
            "detail": s.detail,
            "model_count": counts.get(s.provider, 0),
        }
        for s in statuses
    ]
    return {"items": items, "meta": {"source": "connection-manager"}}
