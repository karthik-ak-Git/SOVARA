"""Structured audit event (Phase 0: shape only).

The full audit platform arrives later; every future component must emit
these events so confidential-work traceability is built in, not bolted on.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class AuditEventType(StrEnum):
    TASK_CREATED = "task.created"
    TASK_COMPLETED = "task.completed"
    MODEL_CALLED = "model.called"
    TOOL_CALLED = "tool.called"
    KNOWLEDGE_ACCESSED = "knowledge.accessed"
    ARTIFACT_CREATED = "artifact.created"
    AUTH_DECISION = "auth.decision"
    POLICY_DECISION = "policy.decision"


class AuditEventStatus(StrEnum):
    STARTED = "started"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    DENIED = "denied"


class AuditEvent(BaseModel):
    event_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    actor: str
    task_id: str | None = None
    event_type: AuditEventType
    component: str
    action: str
    status: AuditEventStatus
    metadata: dict[str, Any] = Field(default_factory=dict)
