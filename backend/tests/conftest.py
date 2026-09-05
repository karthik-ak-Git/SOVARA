"""Shared test fixtures: isolated app per test with test settings."""

import pytest
from fastapi.testclient import TestClient

from sovara.infrastructure.config.settings import Settings
from sovara.main import create_app


@pytest.fixture()
def settings() -> Settings:
    return Settings(
        env="test",
        app_name="SOVARA",
        app_version="0.1.0",
        api_prefix="/api/v1",
        network_local_only=True,
        network_allowed_endpoints=[],
        auth_mode="disabled",
    )


@pytest.fixture()
def client(settings: Settings) -> TestClient:
    app = create_app(settings)
    with TestClient(app) as c:
        yield c
