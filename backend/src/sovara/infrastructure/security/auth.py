"""Authentication / authorization abstraction (Phase 0).

No production auth, no SSO, no RBAC matrix yet. This module fixes the seam:
- API depends on AuthProvider, never on a concrete scheme.
- Phase 0 ships a permissive DisabledAuthProvider (local dev only) and the
  interface for a future token provider. Production must refuse `disabled`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum


class AuthMode(StrEnum):
    DISABLED = "disabled"
    TOKEN = "token"


@dataclass(frozen=True)
class AuthContext:
    subject: str
    roles: tuple[str, ...] = ()
    authenticated: bool = False
    metadata: dict[str, str] = field(default_factory=dict)


class AuthProvider(ABC):
    @abstractmethod
    def authenticate(self, token: str | None) -> AuthContext:
        """Validate a credential (or lack thereof) into an AuthContext."""

    @abstractmethod
    def authorize(self, context: AuthContext, action: str, resource: str) -> bool:
        """Decide allow/deny for an action on a resource."""


class DisabledAuthProvider(AuthProvider):
    """Local-development only. Must never be selected in production."""

    def authenticate(self, token: str | None = None) -> AuthContext:
        return AuthContext(subject="local-dev", authenticated=False)

    def authorize(self, context: AuthContext, action: str, resource: str) -> bool:
        return True


def provider_for_mode(mode: AuthMode) -> AuthProvider:
    if mode == AuthMode.DISABLED:
        return DisabledAuthProvider()
    raise NotImplementedError(
        "Token auth provider arrives in a later phase; "
        "production must not run with auth_mode=disabled."
    )
