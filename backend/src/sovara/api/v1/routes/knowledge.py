"""Knowledge boundary (Phase 0: contract only, no ingestion/retrieval)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from sovara.api.schemas import PHASE

router = APIRouter(tags=["knowledge"])


class KnowledgeSearch(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=5, ge=1, le=50)


@router.post("/knowledge/search")
def search_knowledge(body: KnowledgeSearch) -> dict[str, object]:
    return {
        "items": [],
        "meta": {
            "phase": PHASE,
            "query": body.query,
            "top_k": body.top_k,
            "retrieval": "deferred",
        },
    }


@router.get("/knowledge/documents")
def list_documents() -> dict[str, object]:
    return {"items": [], "meta": {"phase": PHASE, "ingestion": "deferred"}}
