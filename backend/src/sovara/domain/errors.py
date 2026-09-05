"""Consistent error model for SOVARA.

Every API error uses the envelope:
    {"error": {"code": ..., "message": ..., "details": ..., "request_id": ...}}

Categories map 1:1 to ErrorCode values so future components
(model gateway, tools, agent, knowledge, infra, security) share one format.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    VALIDATION = "validation_error"
    AUTHENTICATION = "authentication_error"
    AUTHORIZATION = "authorization_error"
    MODEL = "model_error"
    TOOL = "tool_error"
    AGENT = "agent_error"
    KNOWLEDGE = "knowledge_error"
    INFRASTRUCTURE = "infrastructure_error"
    SECURITY_POLICY = "security_policy_violation"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    INTERNAL = "internal_error"


class SovaraError(Exception):
    """Base error. Never raised directly with a generic message to clients."""

    code: ErrorCode = ErrorCode.INTERNAL
    status_code: int = 500

    def __init__(
        self,
        message: str,
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_envelope(self, request_id: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code.value, "message": self.message}
        if self.details:
            body["details"] = self.details
        if request_id:
            body["request_id"] = request_id
        return {"error": body}


class ValidationError(SovaraError):
    code = ErrorCode.VALIDATION
    status_code = 422


class AuthenticationError(SovaraError):
    code = ErrorCode.AUTHENTICATION
    status_code = 401


class AuthorizationError(SovaraError):
    code = ErrorCode.AUTHORIZATION
    status_code = 403


class ModelError(SovaraError):
    code = ErrorCode.MODEL
    status_code = 502


class ToolError(SovaraError):
    code = ErrorCode.TOOL
    status_code = 502


class AgentError(SovaraError):
    code = ErrorCode.AGENT
    status_code = 500


class KnowledgeError(SovaraError):
    code = ErrorCode.KNOWLEDGE
    status_code = 502


class InfrastructureError(SovaraError):
    code = ErrorCode.INFRASTRUCTURE
    status_code = 503


class SecurityPolicyError(SovaraError):
    """Raised when the air-gap / network policy denies an action."""

    code = ErrorCode.SECURITY_POLICY
    status_code = 403


class NotFoundError(SovaraError):
    code = ErrorCode.NOT_FOUND
    status_code = 404


class ConflictError(SovaraError):
    code = ErrorCode.CONFLICT
    status_code = 409
