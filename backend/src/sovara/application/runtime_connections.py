"""Local runtime connection manager (Slice 3, Part A).

Provider-independent connection management: discover adapters, test
connections, retrieve models, report status, refresh the catalog's view.
Contains zero provider-specific HTTP — it only calls the ModelProvider
ABC (health()/list_models()). Each provider is isolated: one runtime
being down never breaks the others.
"""

from __future__ import annotations

from sovara.application.provider_registry import ProviderRegistry
from sovara.domain.model_provider import ModelInfo
from sovara.domain.runtime import ProviderStatus
from sovara.infrastructure.logging.structured import get_logger

log = get_logger("sovara.runtime")

_RUNTIME_NAMES = {
    "lmstudio": "LM Studio",
    "ollama": "Ollama",
    "echo": "Dev harness",
}


class RuntimeConnectionManager:
    def __init__(
        self,
        providers: ProviderRegistry,
        *,
        base_urls: dict[str, str] | None = None,
    ) -> None:
        self._providers = providers
        self._base_urls = dict(base_urls or {})

    @property
    def provider_registry(self) -> ProviderRegistry:
        return self._providers

    @staticmethod
    def runtime_name(kind: str) -> str:
        return _RUNTIME_NAMES.get(kind, kind)

    async def check_connections(self) -> list[ProviderStatus]:
        """Health-probe every adapter; a down runtime reports, never raises."""
        statuses: list[ProviderStatus] = []
        for kind in self._providers.kinds():
            provider = self._providers.get(kind)
            assert provider is not None  # kinds() derives from the same map
            try:
                health = await provider.health()
                connected = health.available
                detail = health.detail
            except Exception as exc:  # isolation: one bad adapter can't break the rest
                connected = False
                detail = f"probe failed: {exc.__class__.__name__}"
                log.warning("runtime probe failed provider=%s error=%s", kind, detail)
            statuses.append(
                ProviderStatus(
                    provider=kind,
                    runtime=self.runtime_name(kind),
                    base_url=self._base_urls.get(kind, ""),
                    connected=connected,
                    detail=detail,
                )
            )
        # Diagnostic only: kinds + connectivity, never URLs with secrets
        # (base URLs are loopback config, no credentials by construction).
        log.info(
            "runtime connections checked providers=%d connected=%d",
            len(statuses),
            sum(1 for s in statuses if s.connected),
        )
        return statuses

    async def discover_models(self) -> dict[str, list[ModelInfo]]:
        """List models per adapter; discovery failure is [], never an exception."""
        found: dict[str, list[ModelInfo]] = {}
        for kind in self._providers.kinds():
            provider = self._providers.get(kind)
            assert provider is not None
            try:
                found[kind] = await provider.list_models()
            except Exception as exc:  # isolation, same contract as adapters
                found[kind] = []
                log.warning(
                    "runtime discovery failed provider=%s error=%s", kind, exc.__class__.__name__
                )
        log.info(
            "runtime discovery finished providers=%d models=%d",
            len(found),
            sum(len(v) for v in found.values()),
        )
        return found
