"""LM Studio local-runtime adapter (OpenAI-compatible API, default :1234).

Isolates everything LM Studio-specific (base URL with /v1 prefix,
/chat/completions SSE protocol, [DONE] terminator) behind the
ModelProvider ABC. Application code never touches httpx or OpenAI
response shapes.

Failure mapping (same contract as the Ollama adapter):
- unreachable / timeout  -> ModelError "Local model unavailable" (502)
- non-2xx from runtime   -> ModelError with status, no body leak
- malformed SSE lines    -> skipped (robust, not brittle)
- runtime "error" field  -> ModelError (generation failure)
"""

from __future__ import annotations

import json
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
    TaskCapability,
)

DONE_MARKER = "[DONE]"


class LMStudioProvider(ModelProvider):
    def __init__(self, *, base_url: str, model: str, timeout_s: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_s
        self._info = ModelInfo(
            model_id=model,
            provider="lmstudio",
            version="0.1.0-slice1",
            capabilities=ModelCapabilities(
                modalities=[Modality.TEXT],
                tasks=[TaskCapability.REASONING, TaskCapability.CODING],
                supports_streaming=True,
                supports_tools=False,
            ),
        )

    @property
    def info(self) -> ModelInfo:
        return self._info

    async def health(self) -> ModelHealth:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(f"{self._base_url}/models")
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
        return InferenceResponse(model_id=self._model, text=text, finish_reason="stop")

    async def list_models(self) -> list[ModelInfo]:
        """Parse GET /v1/models into normalized infos; [] when unreachable."""
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(f"{self._base_url}/models")
        except (httpx.ConnectError, httpx.TimeoutException, OSError):
            return []
        if resp.status_code != 200:
            return []
        try:
            body = resp.json()
        except ValueError:
            return []
        data = body.get("data")
        if not isinstance(data, list):
            return []
        infos: list[ModelInfo] = []
        for entry in data:
            if not isinstance(entry, dict):
                continue
            model_id = entry.get("id")
            if not isinstance(model_id, str) or not model_id:
                continue
            raw_meta = entry.get("meta")
            meta = raw_meta if isinstance(raw_meta, dict) else {}
            context = meta.get("contextLength")
            infos.append(
                ModelInfo(
                    model_id=model_id,
                    display_name=self._display_name(model_id),
                    provider="lmstudio",
                    capabilities=ModelCapabilities(
                        modalities=[Modality.TEXT], supports_streaming=True
                    ),
                    resource=ModelResource(
                        context_window=context if isinstance(context, int) else None
                    ),
                )
            )
        return infos

    @staticmethod
    def _display_name(model_id: str) -> str:
        """'qwen/qwen3.5-9b' -> 'Qwen3.5 9b'. Purely presentational."""
        short = model_id.split("/")[-1].replace("-", " ").replace("_", " ").strip()
        return short[:1].upper() + short[1:] if short else model_id

    async def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        payload = {
            # Slice 2: the resolved (native) model id selects the runtime
            # model; the adapter default is only a fallback.
            "model": request.model_id or self._model,
            "messages": self._to_oai_messages(request),
            "stream": True,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
        }
        try:
            timeout = httpx.Timeout(self._timeout, read=300.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST", f"{self._base_url}/chat/completions", json=payload
                ) as resp:
                    if resp.status_code != 200:
                        raise ModelError(f"Local model runtime error: status {resp.status_code}")
                    async for line in resp.aiter_lines():
                        for delta in self.parse_sse_lines(line):
                            yield delta
        except (httpx.ConnectError, httpx.TimeoutException, OSError) as exc:
            raise ModelError(f"Local model unavailable: {exc.__class__.__name__}") from exc

    @staticmethod
    def parse_sse_lines(line: str) -> list[str]:
        """Extract content deltas from one raw SSE line (pure, testable).

        Returns [] for blanks, comments, [DONE], malformed JSON, or events
        without text. Raises ModelError for runtime "error" payloads.
        """
        text = line.strip()
        if not text or not text.startswith("data:"):
            return []
        data = text[len("data:") :].strip()
        if data == DONE_MARKER:
            return []
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            return []
        if not isinstance(event, dict):
            return []
        if event.get("error"):
            raise ModelError(f"Local model generation failed: {event['error']}")
        deltas: list[str] = []
        choices = event.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                delta: Any = choice.get("delta", {})
                if isinstance(delta, dict):
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        deltas.append(content)
        return deltas

    @staticmethod
    def _to_oai_messages(request: InferenceRequest) -> list[dict[str, str]]:
        if request.messages:
            return [{"role": m.role.value, "content": m.content} for m in request.messages]
        return [{"role": "user", "content": request.prompt}]
