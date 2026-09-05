"""Liveness probe. No dependencies, no I/O."""

from fastapi import APIRouter, Request

from sovara.api.schemas import HealthResponse
from sovara.infrastructure.config.settings import Settings
from sovara.version import __version__

router = APIRouter(tags=["health"])


def _settings(request: Request) -> Settings:
    return request.app.state.settings


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    s: Settings = _settings(request)
    return HealthResponse(status="ok", app=s.app_name, version=__version__, env=s.env)
