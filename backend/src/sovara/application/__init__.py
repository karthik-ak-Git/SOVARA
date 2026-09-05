"""Application / orchestration layer (Phase 0: stubs only).

Real orchestration (planner dispatch, multi-step execution, RAG wiring)
arrives in later phases. This package holds the seams so API routes stay
thin: routes -> application services -> domain contracts.
"""

from sovara.application.system_service import SystemService

__all__ = ["SystemService"]
