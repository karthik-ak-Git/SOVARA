"""Centralized configuration for SOVARA Phase 0.

Single source of truth (cf. backend-dev-guidelines unifiedConfig doctrine,
adapted to Python via Pydantic Settings):

- All values come from environment variables prefixed SOVARA_.
- Sections are logical groupings, not separate files: application, model,
  infrastructure, security/network.
- Never hard-code secrets. No defaults for real credentials (there are none
  in Phase 0 by design).
- SOVARA_ENV selects development | test | production | local.

Environment variables (see backend/.env.example):
    SOVARA_ENV, SOVARA_APP_NAME, SOVARA_APP_VERSION, SOVARA_API_PREFIX,
    SOVARA_HOST, SOVARA_PORT, SOVARA_LOG_LEVEL,
    SOVARA_LOG_CONFIDENTIAL_CONTENT (default false),
    SOVARA_NETWORK_LOCAL_ONLY (default true),
    SOVARA_NETWORK_ALLOWED_ENDPOINTS (comma-separated, default empty),
    SOVARA_NETWORK_AUDIT_LOG (default true),
    SOVARA_AUTH_MODE (disabled | token),
    SOVARA_DATA_DIR, SOVARA_ARTIFACTS_DIR
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

EnvName = Literal["development", "test", "production", "local"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SOVARA_", extra="ignore", populate_by_name=True)

    # -- environment --
    env: EnvName = Field(default="development", alias="ENV")

    # -- application --
    app_name: str = Field(default="SOVARA", alias="APP_NAME")
    app_version: str = Field(default="0.1.0", alias="APP_VERSION")
    api_prefix: str = Field(default="/api/v1", alias="API_PREFIX")
    host: str = Field(default="127.0.0.1", alias="HOST")
    port: int = Field(default=8000, alias="PORT")

    # -- logging --
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    log_confidential_content: bool = Field(default=False, alias="LOG_CONFIDENTIAL_CONTENT")

    # -- network policy (air-gap boundary) --
    network_local_only: bool = Field(default=True, alias="NETWORK_LOCAL_ONLY")
    # NoDecode: keep the raw string so our validator (not JSON) splits it.
    # An empty env value means "no endpoints", never a JSON parse crash.
    network_allowed_endpoints: Annotated[list[str], NoDecode] = Field(
        default_factory=list, alias="NETWORK_ALLOWED_ENDPOINTS"
    )
    network_audit_log: bool = Field(default=True, alias="NETWORK_AUDIT_LOG")
    # CORS: browser origin allowlist for local UI development.
    # Empty = no CORS headers (locked down). Dev default covers vite.
    cors_allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://127.0.0.1:5173", "http://localhost:5173"],
        alias="CORS_ALLOWED_ORIGINS",
    )

    # -- auth (abstraction only in Phase 0) --
    auth_mode: Literal["disabled", "token"] = Field(default="disabled", alias="AUTH_MODE")

    # -- model gateway (Phase 1 / Slice 1: single local model path) --
    model_provider: Literal["ollama", "lmstudio", "echo"] = Field(
        default="ollama", alias="MODEL_PROVIDER"
    )
    model_default_id: str = Field(default="local-default", alias="MODEL_DEFAULT_ID")
    # Slice 3: which local runtimes coexist (comma-separated subset of
    # lmstudio,ollama,echo). The echo harness joins automatically when
    # MODEL_PROVIDER=echo outside production; it is always refused in prod.
    enabled_providers: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["lmstudio", "ollama"], alias="ENABLED_PROVIDERS"
    )
    # Slice 3: deterministic smart routing ("SOVARA Auto"). Manual selection
    # always remains available as an explicit override.
    routing_enabled: bool = Field(default=True, alias="ROUTING_ENABLED")
    ollama_base_url: str = Field(default="http://127.0.0.1:11434", alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="llama3.1", alias="OLLAMA_MODEL")
    ollama_timeout_s: float = Field(default=10.0, alias="OLLAMA_TIMEOUT_S")
    # LM Studio serves an OpenAI-compatible API on :1234 by default.
    # LMSTUDIO_MODEL must match a model currently loaded in LM Studio.
    lmstudio_base_url: str = Field(default="http://127.0.0.1:1234/v1", alias="LMSTUDIO_BASE_URL")
    lmstudio_model: str = Field(default="local-model", alias="LMSTUDIO_MODEL")
    lmstudio_timeout_s: float = Field(default=10.0, alias="LMSTUDIO_TIMEOUT_S")
    chat_timeout_s: float = Field(default=180.0, alias="CHAT_TIMEOUT_S")
    chat_max_messages: int = Field(default=64, alias="CHAT_MAX_MESSAGES")
    chat_max_prompt_chars: int = Field(default=24000, alias="CHAT_MAX_PROMPT_CHARS")

    # -- infrastructure paths (local-first) --
    data_dir: Path = Field(default=Path("./data"), alias="DATA_DIR")
    artifacts_dir: Path = Field(default=Path("./data/artifacts"), alias="ARTIFACTS_DIR")

    @field_validator("network_allowed_endpoints", "cors_allowed_origins", mode="before")
    @classmethod
    def _split_endpoints(cls, v: object) -> list[str]:
        if v is None or v == "":
            return []
        if isinstance(v, str):
            return [e.strip() for e in v.split(",") if e.strip()]
        if isinstance(v, list):
            return [str(e).strip() for e in v if str(e).strip()]
        return []

    @field_validator("api_prefix")
    @classmethod
    def _prefix_slash(cls, v: str) -> str:
        return v if v.startswith("/") else f"/{v}"

    # -- section views (logical grouping, single source) --
    def app_section(self) -> dict[str, object]:
        return {
            "name": self.app_name,
            "version": self.app_version,
            "env": self.env,
            "api_prefix": self.api_prefix,
        }

    def security_section(self) -> dict[str, object]:
        return {
            "auth_mode": self.auth_mode,
            "network_local_only": self.network_local_only,
            "network_allowed_endpoints": self.network_allowed_endpoints,
            "network_audit_log": self.network_audit_log,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
