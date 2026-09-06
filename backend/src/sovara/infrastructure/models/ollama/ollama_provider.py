"""Ollama local-runtime adapter (Phase 1 / Slice 1 primary model path).

Isolates everything Ollama-specific (base URL, /api/chat NDJSON protocol,
connection failures) behind the ModelProvider ABC. Application code never
touches httpx or Ollama response shapes.

Failure mapping:
- unreachable / timeout  -> ModelError "Local model unavailable" (502)
- non-2xx from runtime   -> ModelError with status, no body leak
- malformed NDJSON lines -> skipped (stream is robust, not brittle)
- runtime "error" field  -> ModelError (generation failure)
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Any

import httpx

from sovara.domain.errors import ModelError
from sovara.domain.model_provider import (
    InferenceRequest,
    InferenceResponse,
    Modality,
    ModelCapabilities,
    ModelHealth,
    ModelInfo,
    ModelProvider,
    ModelResource,
    ModelRole,
    TaskCapability,
    infer_model_role,
)
from sovara.infrastructure.logging.structured import get_logger
from sovara.infrastructure.models.attribution import PROVIDER_HEADERS

log = get_logger("sovara.models.ollama")


class OllamaProvider(ModelProvider):
    def __init__(self, *, base_url: str, model: str, timeout_s: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_s
        self._info = ModelInfo(
            model_id=model,
            provider="ollama",
            version="0.1.0-slice1",
            # Honest unknown: /api/tags advertises no task capabilities,
            # so the configured fallback claims none (see DEEPSEEK_HARNESS_ANALYSIS G2).
            capabilities=ModelCapabilities(
                modalities=[Modality.TEXT],
                tasks=[],
                supports_streaming=True,
                supports_tools=False,
            ),
        )

    @property
    def info(self) -> ModelInfo:
        return self._info

    async def health(self) -> ModelHealth:
        try:
            async with httpx.AsyncClient(timeout=self._timeout, headers=PROVIDER_HEADERS) as client:
                resp = await client.get(f"{self._base_url}/api/tags")
        except (httpx.ConnectError, httpx.TimeoutException, OSError):
            return ModelHealth(model_id=self._model, available=False, detail="runtime unreachable")
        if resp.status_code != 200:
            return ModelHealth(
                model_id=self._model,
                available=False,
                detail=f"runtime status {resp.status_code}",
            )
        return ModelHealth(model_id=self._model, available=True, detail="ok")

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        text = "".join([chunk async for chunk in self.stream(request)])
        # Echo the requested runtime id, never the adapter default.
        return InferenceResponse(model_id=request.model_id, text=text, finish_reason="stop")

    async def list_models(self) -> list[ModelInfo]:
        """Parse /api/tags into normalized infos; [] when unreachable."""
        try:
            async with httpx.AsyncClient(timeout=self._timeout, headers=PROVIDER_HEADERS) as client:
                resp = await client.get(f"{self._base_url}/api/tags")
        except (httpx.ConnectError, httpx.TimeoutException, OSError):
            return []
        if resp.status_code != 200:
            return []
        try:
            body = resp.json()
        except ValueError:
            return []
        models = body.get("models")
        if not isinstance(models, list):
            return []
        infos: list[ModelInfo] = []
        for entry in models:
            if not isinstance(entry, dict):
                continue
            name = entry.get("name")
            if not isinstance(name, str) or not name:
                continue
            raw_details = entry.get("details")
            details = raw_details if isinstance(raw_details, dict) else {}
            role = infer_model_role(name)
            is_embedding = role == ModelRole.EMBEDDING
            infos.append(
                ModelInfo(
                    model_id=name,
                    display_name=name,
                    provider="ollama",
                    role=role,
                    capabilities=ModelCapabilities(
                        modalities=[Modality.TEXT],
                        tasks=[TaskCapability.EMBEDDING] if is_embedding else [],
                        # Embedding models are not chat-streaming candidates.
                        supports_streaming=not is_embedding,
                    ),
                    resource=ModelResource(
                        parameters_b=self._parse_param_size(details.get("parameter_size"))
                    ),
                )
            )
        return infos

    @staticmethod
    def _parse_param_size(raw: Any) -> float | None:
        """'8.0B' -> 8.0, '4B' -> 4.0, '350M' -> 0.35; None when unparseable."""
        if not isinstance(raw, str):
            return None
        match = re.fullmatch(r"\s*([\d.]+)\s*([BMK])?\s*", raw.upper())
        if not match:
            return None
        scale = {"B": 1.0, "M": 1e-3, "K": 1e-6, None: 1.0}[match.group(2)]
        try:
            return float(match.group(1)) * scale
        except ValueError:
            return None

    def build_payload(self, request: InferenceRequest) -> dict[str, object]:
        """Build the runtime request body (pure, testable).

        Identity rule: the resolved (native) model id selects the runtime
        model; the adapter default applies ONLY when the request omits one.
        """
        return {
            "model": request.model_id or self._model,
            "messages": self._to_ollama_messages(request),
            "stream": True,
            "options": {"num_predict": request.max_tokens, "temperature": request.temperature},
        }

    async def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        payload = self.build_payload(request)
        # Diagnostic only: the runtime model id, never prompt content.
        log.info("ollama chat request runtime_model_id=%s", payload["model"])
        try:
            timeout = httpx.Timeout(self._timeout, read=300.0)
            async with httpx.AsyncClient(timeout=timeout, headers=PROVIDER_HEADERS) as client:
                async with client.stream(
                    "POST", f"{self._base_url}/api/chat", json=payload
                ) as resp:
                    if resp.status_code != 200:
                        raise ModelError(f"Local model runtime error: status {resp.status_code}")
                    completed = False
                    async for line in resp.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError:
                            continue  # robust stream: skip malformed lines
                        if event.get("error"):
                            raise ModelError(f"Local model generation failed: {event['error']}")
                        delta = event.get("message", {}).get("content", "")
                        if delta:
                            yield delta
                        if event.get("done"):
                            completed = True
                            break
                    if not completed:
                        # Reference behavior (dsh STREAM_CLOSED): EOF without
                        # the terminal marker is truncation — untrusted,
                        # never silently accepted as a complete turn.
                        raise ModelError("Local model stream ended without completion")
        except (httpx.ConnectError, httpx.TimeoutException, OSError) as exc:
            raise ModelError(f"Local model unavailable: {exc.__class__.__name__}") from exc

    @staticmethod
    def _to_ollama_messages(request: InferenceRequest) -> list[dict[str, str]]:
        if request.messages:
            return [{"role": m.role.value, "content": m.content} for m in request.messages]
        return [{"role": "user", "content": request.prompt}]
