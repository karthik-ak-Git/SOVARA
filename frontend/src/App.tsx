import { lazy, Suspense } from "react";

const StatusPanel = lazy(() =>
  import("./features/status/StatusPanel").then((m) => ({ default: m.StatusPanel })),
);

/** Phase 0 shell: static overview + lazy status feature. No routing yet. */
export function App(): JSX.Element {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto" }}>
      <h1>SOVARA — Phase 0 Foundation</h1>
      <p>
        Sovereign on-premise agentic AI workbench. Phase 0 establishes
        architecture, contracts, and boundaries only — no model inference,
        agents, RAG, OCR, or document generation yet.
      </p>
      <Suspense fallback={<p>Loading…</p>}>
        <StatusPanel />
      </Suspense>
      <section>
        <h2>Deferred to later phases</h2>
        <ul>
          <li>Model gateway + auto-routing</li>
          <li>Agent planner / executor</li>
          <li>Knowledge / RAG + citations</li>
          <li>Tools + sandboxed execution</li>
          <li>DOCX / XLSX / PPTX / PDF generation</li>
        </ul>
      </section>
    </main>
  );
}
