/** MessageList + CodeBlock tests: empty state, rendering, copy. */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";
import { MessageList } from "./MessageList";
import type { UiMessage } from "../types";

describe("MessageList", () => {
  it("renders the welcome empty state", () => {
    render(<MessageList messages={[]} streamingId={null} />);
    expect(screen.getByText("How can I help?")).toBeInTheDocument();
  });

  it("renders user and assistant messages with markdown", () => {
    const messages: UiMessage[] = [
      { id: "u1", role: "user", content: "Hi" },
      { id: "a1", role: "assistant", content: "**bold** answer" },
    ];
    render(<MessageList messages={messages} streamingId={null} />);
    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("shows a generating indicator for empty streaming content", () => {
    const messages: UiMessage[] = [{ id: "a1", role: "assistant", content: "" }];
    render(<MessageList messages={messages} streamingId="a1" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("CodeBlock", () => {
  it("copies code to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<CodeBlock language="python" code="print('hi')" />);
    await user.click(screen.getByRole("button", { name: "Copy code to clipboard" }));
    expect(writeText).toHaveBeenCalledWith("print('hi')");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});
