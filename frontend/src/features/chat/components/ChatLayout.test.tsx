/** ChatLayout model flow: list -> select -> send carries the model id. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatLayout } from "./ChatLayout";
import type { ModelList } from "../../../api/types";

vi.mock("../../../api/client", () => ({
  api: {
    models: vi.fn(),
    status: vi.fn(),
  },
  apiBase: () => "http://127.0.0.1:8000",
  CHAT_PATH: "/api/v1/chat",
}));

vi.mock("../api/chatClient", () => ({
  ChatStreamError: class extends Error {
    kind = "generation";
  },
  streamChat: vi.fn(),
}));

import { api } from "../../../api/client";
import { streamChat } from "../api/chatClient";

const mockModels = vi.mocked(api.models);
const mockStatus = vi.mocked(api.status);
const mockStream = vi.mocked(streamChat);

function list(ids: string[]): ModelList {
  return {
    items: ids.map((id) => ({
      id,
      display_name: id,
      provider: "lmstudio",
      runtime: "LM Studio",
      version: "",
      capabilities: {
        modalities: ["text"],
        tasks: ["reasoning"],
        supports_streaming: true,
        supports_tools: false,
      },
      capability_source: "provider",
      context_window: null,
      parameter_size_b: null,
      availability: "available" as const,
      metadata: {},
    })),
    meta: { routing: "deferred", source: "registry", default_model_id: ids[0] },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockStatus.mockResolvedValue({
    app: "SOVARA",
    version: "0.1.0",
    env: "test",
    api_prefix: "/api/v1",
    models_registered: 2,
    tools_registered: 0,
    network: { local_only: true, allowed_endpoints: [], audit_log: true },
    auth_mode: "disabled",
    capabilities: {},
  });
  mockStream.mockImplementation(async (_messages, { onToken }) => {
    onToken("hello");
    return { modelId: "m", finishReason: "stop" };
  });
});

describe("ChatLayout model flow", () => {
  it("defaults to SOVARA Auto and sends without a model id", async () => {
    const user = userEvent.setup();
    mockModels.mockResolvedValue(list(["model-a", "model-b"]));
    render(<ChatLayout theme="dark" onToggleTheme={() => undefined} />);

    // fresh state -> auto mode
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent(
        "SOVARA Auto",
      ),
    );
    // send routes server-side: no model id, explicit auto mode
    await user.type(screen.getByLabelText("Message SOVARA"), "hi{enter}");
    await waitFor(() => expect(mockStream).toHaveBeenCalled());
    const call = mockStream.mock.calls[0];
    expect(call[2]).toBeUndefined();
    expect(call[3]).toBe("auto");
    expect(call[0]).toEqual([{ role: "user", content: "hi" }]);
  });

  it("shows the routed model after an auto turn", async () => {
    const user = userEvent.setup();
    mockModels.mockResolvedValue(list(["model-a", "model-b"]));
    mockStream.mockImplementation(async (_messages, { onToken }) => {
      onToken("hello");
      return {
        modelId: "model-b",
        finishReason: "stop",
        routing: {
          auto: true,
          task_type: "coding",
          selected_model_id: "model-b",
          reason_codes: ["coding_capability", "available_local_runtime"],
          decision_source: "deterministic_router",
        },
      };
    });
    render(<ChatLayout theme="dark" onToggleTheme={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Select model" })).toBeInTheDocument(),
    );
    await user.type(screen.getByLabelText("Message SOVARA"), "hi{enter}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent(
        "Auto → model-b",
      ),
    );
  });

  it("manual pick persists across reloads and sends with the selected id", async () => {
    const user = userEvent.setup();
    mockModels.mockResolvedValue(list(["model-a", "model-b"]));
    const { unmount } = render(
      <ChatLayout theme="dark" onToggleTheme={() => undefined} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Select model" })).toBeInTheDocument(),
    );
    // switch to manual B
    await user.click(screen.getByRole("button", { name: "Select model" }));
    await user.click(screen.getByRole("option", { name: /model-b/ }));
    expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent(
      "model-b",
    );
    // send carries B through useChat -> streamChat third arg, manual mode
    await user.type(screen.getByLabelText("Message SOVARA"), "hi{enter}");
    await waitFor(() => expect(mockStream).toHaveBeenCalled());
    const call = mockStream.mock.calls[0];
    expect(call[2]).toBe("model-b");
    expect(call[3]).toBe("manual");
    // reload restores the manual pick (mode + id both persist)
    unmount();
    render(<ChatLayout theme="dark" onToggleTheme={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent(
        "model-b",
      ),
    );
  });

  it("disables the composer when nothing is available", async () => {
    mockModels.mockResolvedValue({ items: [], meta: { routing: "deferred", source: "registry", default_model_id: "" } });
    render(<ChatLayout theme="dark" onToggleTheme={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Message SOVARA")).toBeDisabled(),
    );
    expect(
      within(screen.getByRole("main")).getByRole("alert"),
    ).toHaveTextContent("Model unavailable");
  });
});
