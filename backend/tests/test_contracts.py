"""Domain contract tests: registration, serialization, permission defaults."""

from sovara.domain.artifact import Artifact, ArtifactKind
from sovara.domain.audit import AuditEvent, AuditEventStatus, AuditEventType
from sovara.domain.errors import SecurityPolicyError, SovaraError
from sovara.domain.model_registry import ModelRecord
from sovara.domain.tool import Tool, ToolManifest, ToolPermission
from sovara.infrastructure.registries import InMemoryModelRegistry, InMemoryToolRegistry


class _EchoTool(Tool):
    @property
    def manifest(self) -> ToolManifest:
        return ToolManifest(
            name="echo",
            description="Test echo tool",
            input_schema={"type": "object"},
            output_schema={"type": "object"},
        )

    async def execute(self, tool_input: dict) -> dict:
        return {"echo": tool_input}


def test_model_registry_roundtrip() -> None:
    reg = InMemoryModelRegistry()
    reg.register(ModelRecord(model_id="m1", provider="local"))
    assert reg.get("m1") is not None
    assert len(reg.list()) == 1
    assert reg.remove("m1") is True
    assert reg.get("m1") is None


def test_tool_registry_and_default_permission() -> None:
    reg = InMemoryToolRegistry()
    reg.register(_EchoTool())
    tool = reg.get("echo")
    assert tool is not None
    assert ToolPermission.NETWORK_NONE in tool.manifest.permissions
    assert [m.name for m in reg.manifests()] == ["echo"]


def test_audit_event_serializes() -> None:
    e = AuditEvent(
        event_id="e1",
        actor="tester",
        event_type=AuditEventType.TOOL_CALLED,
        component="tools",
        action="echo.execute",
        status=AuditEventStatus.SUCCEEDED,
    )
    assert e.model_dump()["event_type"] == "tool.called"


def test_artifact_serializes() -> None:
    a = Artifact(
        artifact_id="a1",
        kind=ArtifactKind.PDF,
        filename="report.pdf",
        mime_type="application/pdf",
    )
    assert a.model_dump()["kind"] == "pdf"


def test_security_policy_error_envelope() -> None:
    err = SecurityPolicyError("denied")
    body = err.to_envelope("req-1")["error"]
    assert body["code"] == "security_policy_violation"
    assert body["request_id"] == "req-1"
    assert isinstance(err, SovaraError)
