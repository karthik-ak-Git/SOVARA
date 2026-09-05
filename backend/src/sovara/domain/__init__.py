"""Stable domain contracts for SOVARA.

Dependency rule: domain depends on nothing outside itself (stdlib + pydantic).
Application and infrastructure layers depend inward on these contracts.
"""

from sovara.domain.agent import Agent, AgentResult, AgentState, Plan, PlanStep
from sovara.domain.artifact import Artifact, ArtifactKind, ArtifactRef
from sovara.domain.audit import AuditEvent, AuditEventStatus, AuditEventType
from sovara.domain.errors import (
    AgentError,
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    ErrorCode,
    InfrastructureError,
    KnowledgeError,
    ModelError,
    NotFoundError,
    SecurityPolicyError,
    SovaraError,
    ToolError,
    ValidationError,
)
from sovara.domain.knowledge import Citation, KnowledgeHit, KnowledgeProvider
from sovara.domain.model_provider import (
    InferenceRequest,
    InferenceResponse,
    ModelCapabilities,
    ModelHealth,
    ModelInfo,
    ModelProvider,
    ModelResource,
)
from sovara.domain.model_registry import ModelRecord, ModelRegistry
from sovara.domain.tool import Tool, ToolErrorInfo, ToolManifest, ToolPermission
from sovara.domain.tool_registry import ToolRegistry

__all__ = [
    "Agent",
    "AgentResult",
    "AgentState",
    "Artifact",
    "ArtifactKind",
    "ArtifactRef",
    "AuditEvent",
    "AuditEventStatus",
    "AuditEventType",
    "AgentError",
    "AuthenticationError",
    "AuthorizationError",
    "Citation",
    "ConflictError",
    "ErrorCode",
    "InferenceRequest",
    "InferenceResponse",
    "InfrastructureError",
    "KnowledgeError",
    "KnowledgeHit",
    "KnowledgeProvider",
    "ModelCapabilities",
    "ModelError",
    "ModelHealth",
    "ModelInfo",
    "ModelProvider",
    "ModelRecord",
    "ModelRegistry",
    "ModelResource",
    "NotFoundError",
    "Plan",
    "PlanStep",
    "SecurityPolicyError",
    "SovaraError",
    "Tool",
    "ToolError",
    "ToolErrorInfo",
    "ToolManifest",
    "ToolPermission",
    "ToolRegistry",
    "ValidationError",
]
