import { Suspense, lazy, useCallback, useState } from "react";
import "./features/chat/styles/chat.css";

const ChatLayout = lazy(() =>
  import("./features/chat/components/ChatLayout").then((m) => ({
    default: m.ChatLayout,
  })),
);

type Theme = "dark" | "light";

/** SOVARA chat shell: theme ownership + lazy chat feature. */
export function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>("dark");
  const toggle = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <div data-theme={theme}>
      <Suspense fallback={<p>Loading SOVARA…</p>}>
        <ChatLayout theme={theme} onToggleTheme={toggle} />
      </Suspense>
    </div>
  );
}
