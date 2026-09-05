"""Generic artifact representation (Phase 0: shape only).

Future generators (DOCX/XLSX/PPTX/PDF/code/image) all return this type
so the API, audit log, and UI handle files uniformly.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ArtifactKind(StrEnum):
    DOCX = "docx"
    XLSX = "xlsx"
    PPTX = "pptx"
    PDF = "pdf"
    CODE = "code"
    IMAGE = "image"
    TEXT = "text"
    OTHER = "other"


class Artifact(BaseModel):
    artifact_id: str
    kind: ArtifactKind
    filename: str
    mime_type: str
    size_bytes: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    metadata: dict[str, str] = Field(default_factory=dict)


class ArtifactRef(BaseModel):
    artifact_id: str
    download_path: str
