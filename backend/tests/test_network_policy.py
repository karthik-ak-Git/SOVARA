"""Network policy gate tests (deny-by-default, explicit allowlist)."""

from sovara.infrastructure.security.network_policy import NetworkPolicy


def test_local_only_denies_external() -> None:
    p = NetworkPolicy(local_only=True)
    d = p.check_egress("https://example.com/models")
    assert d.allowed is False
    assert d.host == "example.com"


def test_allowlist_permits_listed_host() -> None:
    p = NetworkPolicy(local_only=True, allowed_endpoints=("updates.internal",))
    assert p.check_egress("https://updates.internal/v1").allowed is True
    assert p.check_egress("https://other.internal/v1").allowed is False


def test_loopback_always_allowed() -> None:
    p = NetworkPolicy(local_only=True)
    assert p.check_egress("http://127.0.0.1:8000/api/v1/health").allowed is True


def test_unparseable_denied() -> None:
    p = NetworkPolicy(local_only=True)
    assert p.check_egress("").allowed is False
