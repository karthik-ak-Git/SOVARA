"""Agent contract (Phase 0: interface only).

The agent loop (planning + autonomous tool execution) is explicitly
deferred. This file fixes the shapes so planner/executor/state/memory
can be built later without breaking API or tool boundaries.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class AgentState(StrEnum):
    CREATED = "created"
    PLANNING = "planning"
    EXECUTING = "executing"
    WAITING = "waiting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class PlanStep(BaseModel):
    step_id: str
    title: str
    tool_name: str | None = None
    input: dict[str, Any] = Field(default_factory=dict)


class Plan(BaseModel):
    plan_id: str
    goal: str
    steps: list[PlanStep] = Field(default_factory=list)


class ToolCallRecord(BaseModel):
    tool_name: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    status: str = "pending"


class AgentResult(BaseModel):
    task_id: str
    state: AgentState
    summary: str = ""
    artifacts: list[str] = Field(default_factory=list)
    observations: list[str] = Field(default_factory=list)


class AgentTask(BaseModel):
    task_id: str
    goal: str
    context: dict[str, Any] = Field(default_factory=dict)


class Agent(ABC):
    """Future agent. Phase 0 provides the type only."""

    @abstractmethod
    async def plan(self, task: AgentTask) -> Plan:
        """Decompose a task (later phase)."""

    @abstractmethod
    async def execute(self, task: AgentTask, plan: Plan) -> AgentResult:
        """Run a plan inside controlled tool boundaries (later phase)."""

    @abstractmethod
    async def status(self, task_id: str) -> AgentState:
        """Report execution state for a task."""
