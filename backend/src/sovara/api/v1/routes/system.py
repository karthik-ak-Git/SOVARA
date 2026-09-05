"""System status: real composition of config + registries (no model calls)."""

from fastapi import APIRouter, Depends

from sovara.api.deps import get_system_service
from sovara.application.system_service import SystemService

router = APIRouter(tags=["system"])


@router.get("/status")
def system_status(service: SystemService = Depends(get_system_service)) -> dict[str, object]:
    return service.status()
