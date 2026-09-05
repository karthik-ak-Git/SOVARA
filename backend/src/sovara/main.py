"""FastAPI application factory (Phase 0 foundation).

Layering (backend-dev-guidelines doctrine, adapted to FastAPI):
    routes -> application services -> domain contracts -> infrastructure

- Routes contain zero business logic (they delegate to SystemService/registries).
- All input validated by Pydantic models.
- All errors normalized to one envelope by error_handlers.
- Correlation IDs flow via middleware + contextvars into structured logs.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from sovara.api.error_handlers import register_error_handlers
from sovara.api.schemas import HealthResponse
from sovara.api.v1.router import router as v1_router
from sovara.application.system_service import SystemService
from sovara.infrastructure.config.settings import Settings, get_settings
from sovara.infrastructure.logging.structured import (
    bind_correlation,
    clear_correlation,
    get_logger,
    setup_logging,
)
from sovara.infrastructure.registries import InMemoryModelRegistry, InMemoryToolRegistry
from sovara.infrastructure.security.network_policy import NetworkPolicy
from sovara.version import __version__

log = get_logger("sovara.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    setup_logging(settings.log_level)
    # Phase 0 singletons: empty registries, explicit network policy.
    app.state.models = InMemoryModelRegistry()
    app.state.tools = InMemoryToolRegistry()
    app.state.network = NetworkPolicy.from_settings(
        local_only=settings.network_local_only,
        allowed_endpoints=settings.network_allowed_endpoints,
        audit_log=settings.network_audit_log,
    )
    app.state.system_service = SystemService(
        settings=settings,
        models=app.state.models,
        tools=app.state.tools,
        network=app.state.network,
    )
    log.info("sovara backend starting phase=phase0 env=%s", settings.env)
    yield
    log.info("sovara backend stopping")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        docs_url="/docs",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings

    @app.middleware("http")
    async def _correlation(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        bind_correlation(request_id=request_id)
        try:
            response = await call_next(request)
        finally:
            clear_correlation()
        response.headers["X-Request-ID"] = request_id
        return response

    register_error_handlers(app)

    @app.get("/health", response_model=HealthResponse, tags=["health"])
    def root_health(request: Request) -> HealthResponse:
        s: Settings = request.app.state.settings
        return HealthResponse(status="ok", app=s.app_name, version=__version__, env=s.env)

    app.include_router(v1_router, prefix=settings.api_prefix)
    return app


app = create_app()
