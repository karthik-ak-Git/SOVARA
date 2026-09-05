import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { SystemStatus } from "../../api/types";

/**
 * System status feature — display only. No business logic lives here;
 * data shaping (if ever needed) goes in api/client, not in components.
 */
export function StatusPanel(): JSX.Element {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .status()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <section>
        <h2>Backend status</h2>
        <p role="alert">Backend unreachable: {error}</p>
        <p>Start it with uv (see DEVELOPMENT.md), then reload.</p>
      </section>
    );
  }
  if (status === null) return <p>Loading backend status…</p>;

  return (
    <section>
      <h2>Backend status</h2>
      <dl>
        <dt>App</dt>
        <dd>
          {status.app} {status.version} ({status.env})
        </dd>
        <dt>Network mode</dt>
        <dd>{status.network.local_only ? "local-only (air-gap ready)" : "egress permitted"}</dd>
        <dt>Models / tools registered</dt>
        <dd>
          {status.models_registered} / {status.tools_registered}
        </dd>
        <dt>Auth mode</dt>
        <dd>{status.auth_mode}</dd>
      </dl>
    </section>
  );
}
