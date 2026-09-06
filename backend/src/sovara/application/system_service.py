"""System status service (Phase 0 placeholder logic, stable shape).

Returns structured status composed from configuration + registries.
No model calls, no I/O, no inference.
"""

from __future__ import annotations

from sovara.domain.model_registry import ModelRegistry
from sovara.domain.tool_registry import ToolRegistry
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.security.network_policy import NetworkPolicy
from sovara.version import __version__


class SystemService:
    def __init__(
        self,
        settings: Settings,
        models: ModelRegistry,
        tools: ToolRegistry,
        network: NetworkPolicy,
    ) -> None:
        self._settings = settings
        self._models = models
        self._tools = tools
        self._network = network

    def status(self) -> dict[str, object]:
        s = self._settings
        return {
            "app": s.app_name,
            "version": __version__,
            "env": s.env,
            "api_prefix": s.api_prefix,
            "models_registered": len(self._models.list()),
            "tools_registered": len(self._tools.manifests()),
            "network": self._network.describe(),
            "auth_mode": s.auth_mode,
            "capabilities": {
                "chat_streaming": "slice1",
                "rag": "deferred",
                "agent_loop": "deferred",
                "model_routing": "deferred",
                "ocr": "deferred",
                "document_generation": "deferred",
            },
        }
