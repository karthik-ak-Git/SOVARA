"""Configuration validation tests (no secrets, sane air-gap defaults)."""

from sovara.infrastructure.config.settings import Settings


def test_defaults_are_airgapped() -> None:
    s = Settings(env="test")
    assert s.network_local_only is True
    assert s.network_allowed_endpoints == []
    assert s.log_confidential_content is False


def test_allowed_endpoints_parse_from_csv() -> None:
    s = Settings(env="test", network_allowed_endpoints="a.local, b.local ")  # type: ignore[arg-type]
    assert list(s.network_allowed_endpoints) == ["a.local", "b.local"]


def test_sections_split_app_and_security() -> None:
    s = Settings(env="test")
    assert "api_prefix" in s.app_section()
    assert "network_local_only" in s.security_section()
    assert "api_prefix" not in s.security_section()
