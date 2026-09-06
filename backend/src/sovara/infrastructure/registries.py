"""Phase 0 in-memory registries (test/dev only, no persistence).

These exist so the API foundation and tests can exercise registration
contracts without a database. Persistent catalogs arrive in later phases.
"""

from __future__ import annotations

from sovara.domain.model_registry import ModelAvailability, ModelRecord, ModelRegistry
from sovara.domain.tool import Tool, ToolManifest
from sovara.domain.tool_registry import ToolRegistry


class InMemoryModelRegistry(ModelRegistry):
    def __init__(self) -> None:
        self._records: dict[str, ModelRecord] = {}

    def register(self, record: ModelRecord) -> None:
        self._records[record.model_id] = record

    def get(self, model_id: str) -> ModelRecord | None:
        return self._records.get(model_id)

    def list(self) -> list[ModelRecord]:
        return list(self._records.values())

    def remove(self, model_id: str) -> bool:
        return self._records.pop(model_id, None) is not None

    def set_availability(self, model_id: str, availability: ModelAvailability) -> bool:
        record = self._records.get(model_id)
        if record is None:
            return False
        self._records[model_id] = record.model_copy(update={"availability": availability})
        return True


class InMemoryToolRegistry(ToolRegistry):
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.manifest.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def manifests(self) -> list[ToolManifest]:
        return [t.manifest for t in self._tools.values()]

    def remove(self, name: str) -> bool:
        return self._tools.pop(name, None) is not None
