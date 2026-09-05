"""Knowledge provider contract (Phase 0: interface only).

RAG retrieval, embeddings, reranking, and vector stores are deferred.
This contract fixes ingestion/search/citation shapes for later phases.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field


class Citation(BaseModel):
    document_id: str
    chunk_id: str
    title: str = ""
    page: int | None = None
    score: float | None = None


class KnowledgeHit(BaseModel):
    chunk_id: str
    document_id: str
    text: str
    score: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)
    citations: list[Citation] = Field(default_factory=list)


class KnowledgeProvider(ABC):
    @abstractmethod
    async def ingest(self, document_id: str, content: bytes, metadata: dict[str, Any]) -> str:
        """Stage a document for indexing (later phase). Returns an ingest job id."""

    @abstractmethod
    async def search(self, query: str, top_k: int = 5) -> list[KnowledgeHit]:
        """Retrieve candidate chunks (later phase)."""

    @abstractmethod
    async def fetch(self, document_id: str) -> dict[str, Any]:
        """Fetch stored document metadata (later phase)."""
