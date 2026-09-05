"""Tool contract (Phase 0: interface only).

Tools are independently registerable plugins. The agent never imports
tool implementations directly; it resolves them through a registry by name.
Every tool declares permissions up front so execution can be sandboxed later.

Hard rules (see ADR-0003 / ADR-0004):
- No arbitrary host shell execution.
- No direct host filesystem access; tools receive scoped handles later.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ToolPermission(StrEnum):
    FILE_READ_SCOPED = "file.read.scoped"
    FILE_WRITE_SCOPED = "file.write.scoped"
    CODE_EXEC_SANDBOXED = "code.exec.sandboxed"
    NETWORK_NONE = "network.none"
    NETWORK_ALLOWLISTED = "network.allowlisted"


class ToolManifest(BaseModel):
    name: str
    description: str
    version: str = "0.1.0"
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    permissions: list[ToolPermission] = Field(default_factory=lambda: [ToolPermission.NETWORK_NONE])


class ToolErrorInfo(BaseModel):
    code: str
    message: str
    retryable: bool = False


class Tool(ABC):
    """A single local tool. Implementations arrive in later phases."""

    @property
    @abstractmethod
    def manifest(self) -> ToolManifest:
        """Static declaration used for registration and permission review."""

    @abstractmethod
    async def execute(self, tool_input: dict[str, Any]) -> dict[str, Any]:
        """Run the tool. Must raise ToolError-carrying failures, not raw exits."""
