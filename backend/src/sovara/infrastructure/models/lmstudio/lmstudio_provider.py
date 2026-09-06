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
    ModelRole,
    TaskCapability,
    infer_model_role,
)
from sovara.infrastructure.logging.structured import get_logger
from sovara.infrastructure.models.attribution import PROVIDER_HEADERS

log = get_logger("sovara.models.lmstudio")

DONE_MARKER = "[DONE]"


def is_done_line(line: str) -> bool:
    """True when a raw SSE line is the terminal [DONE] marker (pure, testable)."""
    text = line.strip()
    if not text.startswith("data:"):
        return False
    return text[len("data:") :].strip() == DONE_MARKER


class LMStudioProvider(ModelProvider):
    def __init__(self, *, base_url: str, model: str, timeout_s: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_s
        self._info = ModelInfo(
            model_id=model,
            provider="lmstudio",
            version="0.1.0-slice1",
            # Honest unknown: /v1/models advertises no task capabilities
            # (see DEEPSEEK_HARNESS_ANALYSIS G2).
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
        # Echo the requested runtime id: the response must carry the
        # authoritative identity, never the adapter's configured default.
        return InferenceResponse(model_id=request.model_id, text=text, finish_reason="stop")

    async def list_models(self) -> list[ModelInfo]:
        """Parse GET /v1/models into normalized infos; [] when unreachable."""
        try:
            async with httpx.AsyncClient(timeout=self._timeout, headers=PROVIDER_HEADERS) as client:
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
            role = infer_model_role(model_id)
            is_embedding = role == ModelRole.EMBEDDING
            infos.append(
                ModelInfo(
                    model_id=model_id,
                    display_name=self._display_name(model_id),
                    provider="lmstudio",
                    role=role,
                    capabilities=ModelCapabilities(
                        modalities=[Modality.TEXT],
                        tasks=[TaskCapability.EMBEDDING] if is_embedding else [],
                        supports_streaming=not is_embedding,
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

    def build_payload(self, request: InferenceRequest) -> dict[str, object]:
        """Build the runtime request body (pure, testable).

        Identity rule: the resolved (native) model id selects the runtime
        model; the adapter default applies ONLY when the request omits one.
        """
        return {
            "model": request.model_id or self._model,
            "messages": self._to_oai_messages(request),
            "stream": True,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
        }

    async def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        payload = self.build_payload(request)
        # Diagnostic only: the runtime model id, never prompt content.
        log.info("lmstudio chat request runtime_model_id=%s", payload["model"])
        try:
            timeout = httpx.Timeout(self._timeout, read=300.0)
            async with httpx.AsyncClient(timeout=timeout, headers=PROVIDER_HEADERS) as client:
                async with client.stream(
                    "POST", f"{self._base_url}/chat/completions", json=payload
                ) as resp:
                    if resp.status_code != 200:
                        raise ModelError(f"Local model runtime error: status {resp.status_code}")
                    completed = False
                    async for line in resp.aiter_lines():
                        if is_done_line(line):
                            completed = True
                        for delta in self.parse_sse_lines(line):
                            yield delta
                    if not completed:
                        # Reference behavior (dsh STREAM_CLOSED): EOF without
                        # [DONE] is truncation — untrusted, never silently
                        # accepted as a complete turn.
                        raise ModelError("Local model stream ended without completion")
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
