"""Shared request dependencies (DI seam for routes).

Routes never touch globals directly; they receive Settings, registries,
policy, and services through these Depends() providers backed by app.state.
"""

from __future__ import annotations

from fastapi import Request

from sovara.application.chat_service import ChatService
from sovara.application.model_gateway import ModelGateway
from sovara.application.system_service import SystemService
from sovara.domain.model_registry import ModelRegistry
from sovara.domain.tool_registry import ToolRegistry
from sovara.infrastructure.config.settings import Settings
from sovara.infrastructure.security.network_policy import NetworkPolicy


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_model_registry(request: Request) -> ModelRegistry:
    return request.app.state.models


def get_tool_registry(request: Request) -> ToolRegistry:
    return request.app.state.tools


def get_network_policy(request: Request) -> NetworkPolicy:
    return request.app.state.network


def get_system_service(request: Request) -> SystemService:
    return request.app.state.system_service


def get_model_gateway(request: Request) -> ModelGateway:
    return request.app.state.gateway


def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat_service
