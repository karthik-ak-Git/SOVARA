"""Local runtime connection state (Phase 1 / Slice 3).

Provider state is represented separately from model state by design (§6):
a provider can be unreachable while its last-known models stay registered,
and a model can be unavailable while its provider is connected.

No I/O here — health probing lives in provider adapters, orchestration in
RuntimeConnectionManager (application/). No credentials: base_url is the
explicitly configured loopback URL, never a secret.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ProviderStatus(BaseModel):
    """Point-in-time connection state for one local runtime adapter."""

    provider: str  # adapter kind: lmstudio | ollama | echo | future
    runtime: str = ""  # display name, e.g. "LM Studio"
    base_url: str = ""  # explicitly configured URL (no credentials, ever)
    connected: bool = False
    detail: str = "unknown"
    model_count: int = Field(default=0, ge=0)
