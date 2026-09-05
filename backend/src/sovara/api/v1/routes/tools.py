"""Tool catalog boundary (Phase 0: registry reads only, no execution)."""

from fastapi import APIRouter, Depends

from sovara.api.deps import get_tool_registry
from sovara.domain.errors import NotFoundError
from sovara.domain.tool import ToolManifest
from sovara.domain.tool_registry import ToolRegistry

router = APIRouter(tags=["tools"])


@router.get("/tools")
def list_tools(registry: ToolRegistry = Depends(get_tool_registry)) -> dict[str, object]:
    return {
        "items": [m.model_dump() for m in registry.manifests()],
        "meta": {"phase": "phase0-placeholder", "execution": "deferred"},
    }


@router.get("/tools/{name}", response_model=ToolManifest)
def get_tool(name: str, registry: ToolRegistry = Depends(get_tool_registry)) -> ToolManifest:
    tool = registry.get(name)
    if tool is None:
        raise NotFoundError(f"Tool '{name}' not found")
    return tool.manifest
