"""Structured JSON logging for SOVARA.

Rules (Phase 0):
- JSON lines to stdout: timestamp, level, logger, message + correlation ids.
- Correlation: request_id, task_id, conversation_id, agent_run_id,
  tool_execution_id — propagated via contextvars, never guessed.
- Confidential user content is NEVER logged by default. Callers must pass
  explicit non-content fields only. `log_confidential_content` exists in
  Settings purely as a future, audited opt-in and is ignored in Phase 0
  (helper `is_confidential_logging_enabled` documents that).
- No secrets: the formatter never serializes headers, tokens, or bodies.
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

_CORRELATION_FIELDS = (
    "request_id",
    "task_id",
    "conversation_id",
    "agent_run_id",
    "tool_execution_id",
)

_correlation: contextvars.ContextVar[dict[str, str] | None] = contextvars.ContextVar(
    "sovara_correlation", default=None
)


def bind_correlation(**fields: str | None) -> None:
    current = dict(_correlation.get() or {})
    for key, value in fields.items():
        if key in _CORRELATION_FIELDS and value:
            current[key] = value
    _correlation.set(current)


def clear_correlation() -> None:
    _correlation.set({})


def get_correlation() -> dict[str, str]:
    return dict(_correlation.get() or {})


def is_confidential_logging_enabled() -> bool:
    """Always False in Phase 0. Present so future code has one gate to audit."""
    return False


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(get_correlation())
        if record.exc_info and record.exc_info[0] is not None:
            payload["exc_type"] = record.exc_info[0].__name__
        return json.dumps(payload, default=str)


_configured = False


def setup_logging(level: str = "INFO") -> None:
    global _configured
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # Quiet noisy third-party loggers; keep uvicorn access logs structured-minimal.
    for noisy in ("uvicorn.access", "uvicorn.error"):
        logging.getLogger(noisy).handlers = [handler]
        logging.getLogger(noisy).propagate = False
    _configured = True


def get_logger(name: str) -> logging.Logger:
    if not _configured:
        setup_logging()
    return logging.getLogger(name)
