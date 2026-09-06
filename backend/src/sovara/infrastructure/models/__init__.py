"""Local model provider implementations (Phase 1 / Slice 1).

Application code never imports these modules directly; the factory below is
the only construction site, and the rest of SOVARA programs against the
ModelProvider ABC (see ADR-0002).
"""

from sovara.infrastructure.models.echo_provider import EchoProvider
from sovara.infrastructure.models.factory import build_provider
from sovara.infrastructure.models.lmstudio.lmstudio_provider import LMStudioProvider
from sovara.infrastructure.models.ollama.ollama_provider import OllamaProvider

__all__ = ["EchoProvider", "LMStudioProvider", "OllamaProvider", "build_provider"]
