/** Composer tests: keyboard behavior, states. */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

describe("Composer", () => {
  it("sends on Enter and clears the input", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <Composer status="idle" disabled={false} onSend={onSend} onStop={() => undefined} />,
    );
    const box = screen.getByLabelText("Message SOVARA");
    await user.type(box, "Hello{enter}");
    expect(onSend).toHaveBeenCalledWith("Hello");
    expect(box).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <Composer status="idle" disabled={false} onSend={onSend} onStop={() => undefined} />,
    );
    const box = screen.getByLabelText("Message SOVARA");
    await user.type(box, "line one{shift>}{enter}{/shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("line one\nline two");
  });

  it("does not send empty messages", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <Composer status="idle" disabled={false} onSend={onSend} onStop={() => undefined} />,
    );
    await user.type(screen.getByLabelText("Message SOVARA"), "   {enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows Stop while streaming and calls onStop", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(
      <Composer status="streaming" disabled={false} onSend={() => undefined} onStop={onStop} />,
    );
    await user.click(screen.getByRole("button", { name: "Stop generation" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("disables input with a reason when the model is unavailable", () => {
    render(
      <Composer
        status="idle"
        disabled
        disabledReason="Model unavailable — start the local runtime, then reload."
        onSend={() => undefined}
        onStop={() => undefined}
      />,
    );
    expect(screen.getByLabelText("Message SOVARA")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Model unavailable");
  });
});
