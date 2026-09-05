"""Audit boundary (Phase 0: contract only, no event store)."""

from fastapi import APIRouter

from sovara.api.schemas import PHASE, PlaceholderList

router = APIRouter(tags=["audit"])


@router.get("/audit/events", response_model=PlaceholderList)
def list_events() -> PlaceholderList:
    return PlaceholderList(items=[], meta={"phase": PHASE, "event_store": "deferred"})
