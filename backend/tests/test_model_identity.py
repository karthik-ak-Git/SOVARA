"""Model identity regression tests (Slice 2 fix).

Invariant under test, for every chat turn::

    frontend selectedModelId
            ==
    chat request model_id
            ==
    gateway resolved model ID
            ==
    provider request model ID
            ==
    local runtime model ID

Rules:
- An explicit model_id must travel end-to-end unchanged (A->A, B->B).
- The configured default applies ONLY when the request omits model_id.
- Adapter payloads must carry the requested id, never the adapter default.
- Inference responses must echo the requested id, never the adapter default.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Generator
from contextlib import contextmanager

from fastapi.testclient import TestClient

from sovara.application.chat_service import ChatService
from sovara.application.model_gateway import ModelGateway
from sovara.domain.chat import ChatMessage, ChatRole
from sovara.domain.model_provider import (
    InferenceRequest,
    InferenceResponse,
    ModelHealth,
    ModelInfo,
    ModelProvider,
)
from sovara.domain.model_registry import ModelAvailability, ModelRecord
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.models.echo_provider import EchoProvider
from sovara.infrastructure.models.lmstudio.lmstudio_provider import LMStudioProvider
from sovara.infrastructure.models.ollama.ollama_provider import OllamaProvider
from sovara.main import create_app


class _RecordingProvider(ModelProvider):
    """One shared adapter serving many ids, like the LM Studio adapter in prod.

    ``main.lifespan`` maps every registry id to the SAME provider instance;
    multiplexing happens via ``request.model_id``. This stub records each
    requested id so tests can prove explicit ids survive end-to-end.
    """

    def __init__(self, default_model_id: str) -> None:
        self._default = default_model_id
        self.seen: list[str] = []
        self._info = ModelInfo(model_id=default_model_id, provider="stub-multi")

    @property
    def info(self) -> ModelInfo:
        return self._info

    async def health(self) -> ModelHealth:
        return ModelHealth(model_id=self._default, available=True, detail="stub")

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        text = "".join([chunk async for chunk in self.stream(request)])
        return InferenceResponse(model_id=request.model_id, text=text, finish_reason="stop")

    async def stream(self, request: InferenceRequest) -> AsyncIterator[str]:
        self.seen.append(request.model_id)
        yield "ok "

    async def list_models(self) -> list[ModelInfo]:
        return [self._info]


@contextmanager
def _client_with_two_models() -> Generator[tuple[TestClient, _RecordingProvider], None, None]:
    settings = Settings(
        env="test",
        model_provider="echo",
        model_default_id="echo-dev",
    )
    app = create_app(settings)
    provider = _RecordingProvider("model-a")
    with TestClient(app) as client:
        registry = app.state.models
        for mid in ("model-a", "model-b"):
            registry.register(
                ModelRecord(
                    model_id=mid,
                    display_name=mid,
                    provider="stub-multi",
                    availability=ModelAvailability.AVAILABLE,
                )
            )
        gateway = ModelGateway(
            registry=registry,
            providers={"model-a": provider, "model-b": provider},
            default_model_id="model-a",
        )
        app.state.gateway = gateway
        app.state.chat_service = ChatService(settings=settings, gateway=gateway)
        yield client, provider


def _turn(model_id: str | None = None) -> dict[str, object]:
    body: dict[str, object] = {"messages": [{"role": "user", "content": "hi"}]}
    if model_id is not None:
        body["model_id"] = model_id
    return body


def _done_model_id(text: str) -> str:
    done: list[dict[str, object]] = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                done.append(json.loads(line[len("data: ") :]))
    done = [e for e in done if e["type"] == "done"]
    assert len(done) == 1
    return str(done[0]["model_id"])


def test_select_a_sends_a_backend_to_provider() -> None:
    with _client_with_two_models() as (client, provider):
        res = client.post("/api/v1/chat", json=_turn("model-a"))
        assert res.status_code == 200
        assert _done_model_id(res.text) == "model-a"
        assert provider.seen == ["model-a"]


def test_select_b_sends_b_backend_to_provider() -> None:
    with _client_with_two_models() as (client, provider):
        res = client.post("/api/v1/chat", json=_turn("model-b"))
        assert res.status_code == 200
        assert _done_model_id(res.text) == "model-b"
        assert provider.seen == ["model-b"]


def test_switching_models_routes_each_turn_to_its_selection() -> None:
    with _client_with_two_models() as (client, provider):
        first = client.post("/api/v1/chat", json=_turn("model-a"))
        second = client.post("/api/v1/chat", json=_turn("model-b"))
        assert _done_model_id(first.text) == "model-a"
        assert _done_model_id(second.text) == "model-b"
        assert provider.seen == ["model-a", "model-b"]


def test_default_used_only_when_model_omitted() -> None:
    with _client_with_two_models() as (client, provider):
        # Omitted -> configured default.
        assert _done_model_id(client.post("/api/v1/chat", json=_turn()).text) == "model-a"
        # Explicit B -> B, never the default.
        assert _done_model_id(client.post("/api/v1/chat", json=_turn("model-b")).text) == "model-b"
        assert provider.seen == ["model-a", "model-b"]


def test_lmstudio_payload_uses_explicit_id_not_adapter_default() -> None:
    provider = LMStudioProvider(base_url="http://127.0.0.1:1/v1", model="adapter-default")
    req = InferenceRequest(model_id="explicit-model", prompt="hi")
    assert provider.build_payload(req)["model"] == "explicit-model"


def test_lmstudio_payload_falls_back_only_when_omitted() -> None:
    provider = LMStudioProvider(base_url="http://127.0.0.1:1/v1", model="adapter-default")
    req = InferenceRequest(model_id="", prompt="hi")
    assert provider.build_payload(req)["model"] == "adapter-default"


def test_ollama_payload_uses_explicit_id_not_adapter_default() -> None:
    provider = OllamaProvider(base_url="http://127.0.0.1:1", model="adapter-default")
    req = InferenceRequest(model_id="explicit-model", prompt="hi")
    assert provider.build_payload(req)["model"] == "explicit-model"


def test_ollama_payload_falls_back_only_when_omitted() -> None:
    provider = OllamaProvider(base_url="http://127.0.0.1:1", model="adapter-default")
    req = InferenceRequest(model_id="", prompt="hi")
    assert provider.build_payload(req)["model"] == "adapter-default"


def test_infer_echoes_requested_id() -> None:
    async def go() -> None:
        providers: list[ModelProvider] = [
            LMStudioProvider(base_url="http://127.0.0.1:1/v1", model="adapter-default"),
            OllamaProvider(base_url="http://127.0.0.1:1", model="adapter-default"),
            EchoProvider(model_id="echo-default"),
        ]
        for provider in providers:

            async def _fake(_request: InferenceRequest) -> AsyncIterator[str]:
                yield "hi"

            provider.stream = _fake  # type: ignore[method-assign]
            req = InferenceRequest(
                model_id="explicit-model",
                prompt="hi",
                messages=[ChatMessage(role=ChatRole.USER, content="hi")],
            )
            resp = await provider.infer(req)
            assert resp.model_id == "explicit-model"

    asyncio.run(go())
