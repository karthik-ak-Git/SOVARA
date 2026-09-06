/** ModelSelector tests: list, select, unavailable, details, retry. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ModelItem } from "../../../api/types";
import { ModelSelector } from "./ModelSelector";

function model(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    id: "qwen/qwen3.5-9b",
    display_name: "Qwen3.5 9b",
    provider: "lmstudio",
    runtime: "LM Studio",
    version: "",
    capabilities: {
      modalities: ["text"],
      tasks: ["reasoning", "coding"],
      supports_streaming: true,
      supports_tools: false,
    },
    capability_source: "provider",
    context_window: 32000,
    parameter_size_b: 9.0,
    availability: "available",
    metadata: {},
    ...overrides,
  };
}

const MODELS = [
  model(),
  model({
    id: "nvidia/nemotron-3-nano-4b",
    display_name: "Nemotron 3 Nano",
    context_window: null,
    parameter_size_b: null,
  }),
  model({
    id: "old/retired-1b",
    display_name: "Retired",
    availability: "unavailable",
    context_window: null,
    parameter_size_b: 1.0,
  }),
];

describe("ModelSelector", () => {
  it("lists models with capability and context meta", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={MODELS}
        selectedId={MODELS[0].id}
        loading={false}
        loadError={false}
        onSelect={() => undefined}
        onRetryLoad={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select model" }));
    const list = screen.getByRole("listbox");
    expect(
      within(list).getByRole("option", { name: /Qwen3\.5 9b/ }),
    ).toBeInTheDocument();
    expect(within(list).getByText("Reasoning • Coding • 32K")).toBeInTheDocument();
    expect(
      within(list).getByRole("option", { name: /Nemotron 3 Nano/ }),
    ).toBeInTheDocument();
  });

  it("selects a model and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={MODELS}
        selectedId={MODELS[0].id}
        loading={false}
        loadError={false}
        onSelect={onSelect}
        onRetryLoad={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select model" }));
    await user.click(screen.getByRole("option", { name: /Nemotron 3 Nano/ }));
    expect(onSelect).toHaveBeenCalledWith("nvidia/nemotron-3-nano-4b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("disables unavailable models but shows them", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={MODELS}
        selectedId={MODELS[0].id}
        loading={false}
        loadError={false}
        onSelect={onSelect}
        onRetryLoad={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select model" }));
    const retired = screen.getByRole("option", { name: /Retired/ });
    expect(retired).toBeDisabled();
    expect(within(screen.getByRole("listbox")).getByText("Unavailable")).toBeInTheDocument();
    await user.click(retired);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows selected-model details with honest unknowns", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={MODELS}
        selectedId={MODELS[1].id}
        loading={false}
        loadError={false}
        onSelect={() => undefined}
        onRetryLoad={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select model" }));
    const list = screen.getByRole("listbox");
    expect(within(list).getByText("LM Studio")).toBeInTheDocument();
    expect(within(list).getByText("Local")).toBeInTheDocument();
    // null context window renders as em-dash, never invented
    const details = screen.getByText("Context").closest("div");
    expect(details?.textContent).toContain("—");
  });

  it("offers retry when loading fails with no models", async () => {
    const user = userEvent.setup();
    const onRetryLoad = vi.fn();
    render(
      <ModelSelector
        models={[]}
        selectedId={null}
        loading={false}
        loadError
        onSelect={() => undefined}
        onRetryLoad={onRetryLoad}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select model" }));
    await user.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetryLoad).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        models={MODELS}
        selectedId={MODELS[0].id}
        loading={false}
        loadError={false}
        onSelect={() => undefined}
        onRetryLoad={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select model" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
