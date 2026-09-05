"""Artifact boundary (Phase 0: contract only, no generation)."""

from fastapi import APIRouter

from sovara.api.schemas import PHASE, PlaceholderList

router = APIRouter(tags=["artifacts"])


@router.get("/artifacts", response_model=PlaceholderList)
def list_artifacts() -> PlaceholderList:
    return PlaceholderList(items=[], meta={"phase": PHASE, "generation": "deferred"})
