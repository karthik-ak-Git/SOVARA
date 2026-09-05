"""v1 router aggregation: the stable frontend<->backend contract surface."""

from fastapi import APIRouter

from sovara.api.v1.routes import (
    artifacts,
    audit,
    conversations,
    health,
    knowledge,
    models,
    system,
    tasks,
    tools,
)

router = APIRouter()
router.include_router(health.router)
router.include_router(system.router)
router.include_router(models.router)
router.include_router(conversations.router)
router.include_router(tasks.router)
router.include_router(tools.router)
router.include_router(knowledge.router)
router.include_router(artifacts.router)
router.include_router(audit.router)
