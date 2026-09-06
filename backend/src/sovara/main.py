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
from fastapi.middleware.cors import CORSMiddleware

from sovara.api.error_handlers import register_error_handlers
from sovara.api.schemas import HealthResponse
from sovara.api.v1.router import router as v1_router
from sovara.application.chat_service import ChatService
from sovara.application.model_catalog import ModelCatalog
from sovara.application.model_gateway import ModelGateway
from sovara.application.model_router import ModelRouter
from sovara.application.runtime_connections import RuntimeConnectionManager
from sovara.application.system_service import SystemService
from sovara.infrastructure.config.settings import Settings, get_settings
from sovara.infrastructure.logging.structured import (
    bind_correlation,
    clear_correlation,
    get_logger,
    setup_logging,
)
from sovara.infrastructure.models.factory import (
    build_provider_registry,
    runtime_base_urls,
)
from sovara.infrastructure.registries import InMemoryModelRegistry, InMemoryToolRegistry
from sovara.infrastructure.security.network_policy import NetworkPolicy
from sovara.version import __version__

log = get_logger("sovara.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    setup_logging(settings.log_level)
    # Singletons: registries, explicit network policy, then the Slice 1
    # local model path (provider built + registered by the factory).
    app.state.models = InMemoryModelRegistry()
    app.state.tools = InMemoryToolRegistry()
    app.state.network = NetworkPolicy.from_settings(
        local_only=settings.network_local_only,
        allowed_endpoints=settings.network_allowed_endpoints,
        audit_log=settings.network_audit_log,
    )
    # Slice 3 lifecycle: build every enabled local runtime -> probe +
    # discover via the connection manager -> normalize through the catalog
    # -> resolve default -> map every record to its serving adapter.
    provider_registry, configured_ids = await build_provider_registry(settings, app.state.network)
    app.state.provider_registry = provider_registry
    app.state.connection_manager = RuntimeConnectionManager(
        provider_registry, base_urls=runtime_base_urls(settings)
    )
    app.state.catalog = ModelCatalog(
        manager=app.state.connection_manager,
        registry=app.state.models,
        configured_model_ids=configured_ids,
        preferred_default=settings.model_default_id,
        primary_kind=settings.model_provider,
    )
    await app.state.catalog.refresh()
    default_id = app.state.catalog.resolve_default(settings.model_default_id)
    app.state.gateway = ModelGateway(
        registry=app.state.models,
        providers=app.state.catalog.provider_map(),
        default_model_id=default_id,
    )
    app.state.router = ModelRouter(configured_model_id=default_id)
    app.state.chat_service = ChatService(
        settings=settings,
        gateway=app.state.gateway,
        router=app.state.router,
        registry=app.state.models,
    )
    app.state.system_service = SystemService(
        settings=settings,
        models=app.state.models,
        tools=app.state.tools,
        network=app.state.network,
    )
    log.info(
        "sovara backend starting env=%s model_provider=%s model=%s",
        settings.env,
        settings.model_provider,
        settings.model_default_id,
    )
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

    # Local-UI CORS only: allowlisted browser origins get ACAO headers.
    # Empty allowlist = no CORS middleware at all (locked down default).
    if settings.cors_allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_allowed_origins,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type", "Accept", "X-Request-ID", "Authorization"],
            max_age=600,
        )

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
