"""Network / air-gap policy boundary (Phase 0: explicit, enforced at one gate).

Principle: external network access is deny-by-default and must pass through
NetworkPolicy.check_egress(). Future code (model downloads, tool fetch, RAG
crawlers) must call this gate instead of opening sockets directly.

- local_only=True  -> every external host is denied unless allowlisted.
- allowed_endpoints -> explicit exception list (empty by default).
- Audit logging of decisions is ON by default and handled by callers via
  the returned decision (the policy itself never performs I/O in Phase 0).

This is the seam where a real firewall/network-deny policy plugs in later
(see ADR-0005). It is not a badge; it is the single choke point.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class EgressDecision:
    allowed: bool
    host: str
    reason: str


@dataclass(frozen=True)
class NetworkPolicy:
    local_only: bool = True
    allowed_endpoints: tuple[str, ...] = ()
    audit_log: bool = True

    def check_egress(self, url_or_host: str) -> EgressDecision:
        host = self._host_of(url_or_host)
        if not host:
            return EgressDecision(allowed=False, host=url_or_host, reason="unparseable destination")
        if host in ("localhost", "127.0.0.1", "::1"):
            return EgressDecision(allowed=True, host=host, reason="loopback")
        if host in self.allowed_endpoints:
            return EgressDecision(allowed=True, host=host, reason="allowlisted")
        if self.local_only:
            return EgressDecision(allowed=False, host=host, reason="local-only mode denies egress")
        return EgressDecision(allowed=True, host=host, reason="egress permitted")

    @staticmethod
    def _host_of(url_or_host: str) -> str:
        candidate = url_or_host.strip()
        if not candidate:
            return ""
        if "://" not in candidate:
            candidate = f"scheme://{candidate}"
        try:
            return urlparse(candidate).hostname or ""
        except ValueError:
            return ""

    @classmethod
    def from_settings(
        cls,
        *,
        local_only: bool,
        allowed_endpoints: list[str] | tuple[str, ...] = (),
        audit_log: bool = True,
    ) -> NetworkPolicy:
        return cls(
            local_only=local_only,
            allowed_endpoints=tuple(allowed_endpoints),
            audit_log=audit_log,
        )

    def describe(self) -> dict[str, object]:
        return {
            "local_only": self.local_only,
            "allowed_endpoints": list(self.allowed_endpoints),
            "audit_log": self.audit_log,
        }
