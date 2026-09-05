"""Tool registry contract (Phase 0: interface only).

Tools register independently by name; the future agent resolves them here
instead of importing implementations directly.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from sovara.domain.tool import Tool, ToolManifest


class ToolRegistry(ABC):
    @abstractmethod
    def register(self, tool: Tool) -> None:
        """Register a tool instance by its manifest name."""

    @abstractmethod
    def get(self, name: str) -> Tool | None:
        """Fetch a tool by name, or None when unknown."""

    @abstractmethod
    def manifests(self) -> list[ToolManifest]:
        """List manifests of all registered tools."""

    @abstractmethod
    def remove(self, name: str) -> bool:
        """Remove a tool; returns True when something was removed."""
