"""Central error handlers: one envelope for every failure."""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from sovara.domain.errors import ErrorCode, SovaraError
from sovara.infrastructure.logging.structured import get_correlation


def _request_id(request: Request) -> str:
    rid = get_correlation().get("request_id")
    if rid:
        return rid
    header = request.headers.get("x-request-id")
    return header or uuid.uuid4().hex[:12]


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(SovaraError)
    async def _sovara(request: Request, exc: SovaraError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.to_envelope(_request_id(request)),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": ErrorCode.VALIDATION.value,
                    "message": "Request validation failed",
                    "details": {"errors": exc.errors()},
                    "request_id": _request_id(request),
                }
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = (
            ErrorCode.NOT_FOUND
            if exc.status_code == 404
            else ErrorCode.AUTHORIZATION
            if exc.status_code in (401, 403)
            else ErrorCode.INTERNAL
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": code.value,
                    "message": str(exc.detail),
                    "request_id": _request_id(request),
                }
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Never leak internals: generic message, real detail goes to logs only.
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": ErrorCode.INTERNAL.value,
                    "message": "Internal error",
                    "request_id": _request_id(request),
                }
            },
        )
