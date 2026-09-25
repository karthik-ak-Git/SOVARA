import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "API Reference — SOVARA",
  description:
    "Public and internal API reference for SOVARA: release metadata endpoints, the npm installer package, local model runtime, the typed IPC bridge, MCP integration, and the agent tool protocol.",
};

const apiSections = [
  { id: "overview", label: "Overview" },
  { id: "releases-api", label: "Releases API" },
  { id: "installer-package", label: "Installer Package" },
  { id: "model-runtime", label: "Model Runtime" },
  { id: "ipc-bridge", label: "IPC Bridge" },
  { id: "chat-events", label: "Chat Events" },
  { id: "mcp", label: "MCP" },
  { id: "agent-tools", label: "Agent Tools" },
  { id: "update-channels", label: "Update Channels" },
  { id: "errors", label: "Errors" },
];

function Method({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border/60 bg-secondary/40 px-2 py-0.5 font-mono-tech text-[11px] font-semibold text-foreground/90">
      {children}
    </span>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded-md border border-border/60 bg-secondary/30 px-1.5 py-0.5 font-mono-tech text-[12px] text-foreground/90">
      {children}
    </code>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border/60 py-8 first:border-t-0 first:pt-0">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function ApiDocsPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3">
          <span className="font-mono-tech text-xs font-medium uppercase tracking-[0.2em] text-primary">
            API Reference
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            SOVARA API Documentation
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every interface SOVARA exposes: the public release metadata used by the
            installers, the local model runtime, the typed Electron IPC bridge, the
            chat event stream, MCP connectivity, and the agent tool protocol.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>REST</Badge>
            <Badge>npm</Badge>
            <Badge>IPC</Badge>
            <Badge>JSON-RPC 2.0</Badge>
            <Badge>Event streams</Badge>
          </div>
        </div>

        {/* mobile section nav */}
        <div className="mt-8 flex gap-2 overflow-x-auto pb-2 lg:hidden">
          {apiSections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="shrink-0 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-foreground/85"
            >
              {section.label}
            </a>
          ))}
        </div>

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[14rem_1fr]">
          <aside className="hidden lg:block">
            <nav className="sticky top-24">
              <span className="font-mono-tech text-[10px] uppercase tracking-wider text-muted-foreground">
                On this page
              </span>
              <ul className="mt-3 flex flex-col gap-1.5">
                {apiSections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <div className="min-w-0">
            <Section id="overview" title="Overview">
              <p>
                SOVARA is a local-first desktop application. It has no hosted backend
                and no account system, so almost all APIs are either public GitHub
                endpoints consumed at install time, or in-process contracts between the
                Electron main, preload, and renderer layers.
              </p>
              <p>
                Nothing on this page requires an API key. Authentication appears only
                where a user supplies their own GitHub token to read a private package.
              </p>
            </Section>

            <Section id="releases-api" title="Releases API">
              <p>
                Both the npm installer and the PowerShell installer read release metadata
                from the public GitHub Releases API. This is the single source of truth for
                &ldquo;which build is latest&rdquo;.
              </p>
              <div className="rounded-lg border border-border/60 bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Method>GET</Method>
                  <Code>
                    https://api.github.com/repos/karthik-ak-Git/SOVARA/releases/tags/Sovara-versions
                  </Code>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Unauthenticated. Rate limit: 60 requests/hour per IP. Send{" "}
                  <Code>Accept: application/vnd.github+json</Code>.
                </p>
              </div>
              <p>
                A second endpoint lists every published release and powers the versions
                page and the two highlighted builds on the home page:
              </p>
              <div className="rounded-lg border border-border/60 bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Method>GET</Method>
                  <Code>
                    https://api.github.com/repos/karthik-ak-Git/SOVARA/releases?per_page=30
                  </Code>
                </div>
              </div>
              <p>Response fields consumed by SOVARA:</p>
              <ul className="ml-5 list-disc space-y-1.5">
                <li>
                  <Code>tag_name</Code> — release tag. <Code>Sovara-versions</Code> is a
                  rolling tag; historical releases use semver tags.
                </li>
                <li>
                  <Code>name</Code> — display name, usually carrying the semver.
                </li>
                <li>
                  <Code>published_at</Code> — ISO 8601 timestamp used for ordering.
                </li>
                <li>
                  <Code>draft</Code> / <Code>prerelease</Code> — both filtered out before
                  display.
                </li>
                <li>
                  <Code>assets[].name</Code>, <Code>assets[].size</Code>,{" "}
                  <Code>assets[].browser_download_url</Code>, and — when GitHub provides
                  it — <Code>assets[].digest</Code>.
                </li>
              </ul>
              <p>
                Installer selection prefers{" "}
                <Code>Sovara-Setup-&lt;version&gt;-x64.exe</Code>. Any other{" "}
                <Code>.exe</Code> is accepted as a fallback; blockmaps, updaters,
                helpers, and debug artifacts are never selected.
              </p>
            </Section>

            <Section id="installer-package" title="Installer package">
              <p>
                The installer is published to GitHub Packages as a scoped npm package.
                It is a thin, dependency-free Node.js CLI that fetches release metadata,
                verifies the digest, and launches the setup executable.
              </p>
              <div className="rounded-lg border border-border/60 bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Code>@karthik-ak-git/sovara</Code>
                  <Badge>0.1.5</Badge>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Registry: <Code>https://npm.pkg.github.com</Code> · Requires Node.js
                  &ge; 22 · Windows x64 only
                </p>
              </div>
              <p>Install and run:</p>
              <pre className="overflow-x-auto rounded-lg border border-border/60 bg-secondary/20 p-4 font-mono-tech text-xs text-foreground/90">
{`$env:NODE_AUTH_TOKEN = "<GitHub PAT with read:packages>"
npx --yes --package=@karthik-ak-git/sovara@latest sovara`}
              </pre>
              <p>The CLI exposes a single binary, <Code>sovara</Code>:</p>
              <ul className="ml-5 list-disc space-y-1.5">
                <li>Reads the <Code>Sovara-versions</Code> release.</li>
                <li>Selects the Windows x64 installer asset.</li>
                <li>Downloads to the OS temporary directory via a streamed request.</li>
                <li>
                  Verifies <Code>sha256:…</Code> from the release digest when present,
                  and fails closed on mismatch.
                </li>
                <li>Spawns the installer directly — never through a shell string.</li>
              </ul>
              <p>
                Publishing a new version is tag-driven: push a{" "}
                <Code>package-v&lt;version&gt;</Code> tag and the publish workflow
                validates that the tag matches <Code>package.json</Code>, then publishes
                to GitHub Packages.
              </p>
            </Section>

            <Section id="model-runtime" title="Model runtime">
              <p>
                SOVARA runs inference on your own hardware. The runtime binds to
                loopback only and is never exposed off-device.
              </p>
              <div className="rounded-lg border border-border/60 bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Method>POST</Method>
                  <Code>http://127.0.0.1:&lt;port&gt;/v1/chat/completions</Code>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  OpenAI-compatible surface served by the bundled llama.cpp runtime.
                </p>
              </div>
              <p>Runtime behavior worth knowing when integrating:</p>
              <ul className="ml-5 list-disc space-y-1.5">
                <li>
                  One model is resident at a time. Eviction refuses while a request is
                  active, so callers must release before loading a different model.
                </li>
                <li>
                  The server runs with a single parallel slot and continuous batching, so
                  concurrent requests interleave rather than run truly in parallel.
                </li>
                <li>
                  GPU placement is verified after load. An NVIDIA GPU alone is never
                  reported as proof of acceleration — the measured placement is what the
                  UI reports.
                </li>
                <li>
                  Outbound HTTP is restricted to loopback-verified addresses. Remote
                  hosts, public IPs, and credentialed URLs are rejected.
                </li>
              </ul>
            </Section>

            <Section id="ipc-bridge" title="IPC bridge">
              <p>
                The renderer has no Node.js, filesystem, or Electron access. All
                privileged work crosses a typed <Code>contextBridge</Code> built from a
                single channel whitelist, and every argument is validated with a strict
                schema before a handler runs.
              </p>
              <p>Invoke channels return a serialized value; on channels push events. Representative surface:</p>
              <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border/60 bg-secondary/20">
                    <tr>
                      <th className="px-4 py-2.5 font-mono-tech font-semibold text-foreground">Channel</th>
                      <th className="px-4 py-2.5 font-mono-tech font-semibold text-foreground">Type</th>
                      <th className="px-4 py-2.5 font-mono-tech font-semibold text-foreground">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono-tech text-muted-foreground">
                    {[
                      ["chat:send", "invoke", "Start a turn; returns a run result"],
                      ["chat:cancel", "invoke", "Abort the in-flight turn for a session"],
                      ["chat:approve", "invoke", "Resolve a tool approval or clarify card"],
                      ["events:session", "on", "Live chat stream: deltas, tools, tasks"],
                      ["app:getVersion", "invoke", "Current app version"],
                      ["updates:checkNow", "invoke", "Check the release feed on demand"],
                      ["updates:download", "invoke", "Download an available update"],
                      ["updates:install", "invoke", "Restart and install the update"],
                      ["updates:event", "on", "Update status and download progress"],
                    ].map(([channel, type, purpose]) => (
                      <tr key={channel} className="border-b border-border/40 last:border-b-0">
                        <td className="px-4 py-2.5 text-foreground/90">{channel}</td>
                        <td className="px-4 py-2.5">
                          <Method>{type}</Method>
                        </td>
                        <td className="px-4 py-2.5">{purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                New channels are added to the whitelist only; the preload bridge is
                generated from that table, so a channel that is not declared is not
                reachable from the renderer.
              </p>
            </Section>

            <Section id="chat-events" title="Chat events">
              <p>
                Streaming output arrives on <Code>events:session</Code>. Every event
                carries a <Code>sessionId</Code>, and the renderer filters on the active
                session, so background work in one session never corrupts another.
              </p>
              <p>Event kinds you will see:</p>
              <ul className="ml-5 list-disc space-y-1.5">
                <li>
                  <Code>task:start</Code> / <Code>task:thinking</Code> /{" "}
                  <Code>task:done</Code> / <Code>task:cancelled</Code> — turn lifecycle.
                </li>
                <li>
                  <Code>step:start</Code> / <Code>step:end</Code> — one step of the
                  agent loop.
                </li>
                <li>
                  <Code>tool:start</Code> / <Code>tool:delta</Code> /{" "}
                  <Code>tool:end</Code> — live tool execution.
                </li>
                <li>
                  <Code>assistant-delta</Code> — streamed text, including reasoning
                  tails.
                </li>
                <li>
                  <Code>agent:needs-approval</Code> — a tool or clarify card is waiting on
                  the user.
                </li>
                <li>
                  <Code>model:loading</Code> / <Code>model:ready</Code> — model lifecycle
                  with the measured placement.
                </li>
              </ul>
              <p>
                Durable <Code>tool/call</Code> and <Code>tool/result</Code> records are
                persisted to the session, and recaps are generated from those verified
                effects rather than from what the model claims it did.
              </p>
            </Section>

            <Section id="mcp" title="MCP integration">
              <p>
                Connected Apps are exposed to the agent as Model Context Protocol
                servers. Each enabled server becomes a single{" "}
                <Code>mcp_&lt;name&gt;</Code> tool.
              </p>
              <div className="rounded-lg border border-border/60 bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Method>POST</Method>
                  <Code>&lt;endpoint&gt;</Code>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  JSON-RPC 2.0 <Code>tools/call</Code> over the configured transport
                  (HTTP or stdio).
                </p>
              </div>
              <p>
                Call shape: <Code>{"{ input: string, arguments?: object }"}</Code>. The
                request is forwarded to the server and the result is returned to the
                agent as a tool result. Servers in an error or disconnected state are not
                advertised to the model.
              </p>
            </Section>

            <Section id="agent-tools" title="Agent tools">
              <p>
                The agent may call a fixed set of local tools. Every call is schema
                validated, permission-gated, and recorded in the session trace.
              </p>
              <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border/60 bg-secondary/20">
                    <tr>
                      <th className="px-4 py-2.5 font-mono-tech font-semibold text-foreground">Tool</th>
                      <th className="px-4 py-2.5 font-mono-tech font-semibold text-foreground">Effect</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono-tech text-muted-foreground">
                    {[
                      ["fs_list / fs_read / fs_search", "Inspect the workspace"],
                      ["fs_write / fs_patch", "Create or surgically edit a file"],
                      ["shell_exec", "Run a command; detects dev servers and ports"],
                      ["list_dev_servers / stop_dev_server", "Manage background servers"],
                      ["todo_write", "Replace the structured task list"],
                      ["memory", "Store, recall, or list durable wiki pages"],
                      ["search_skills / read_skill", "Discover and read installed skills"],
                      ["web_search / web_fetch", "Search and read pages"],
                      ["clarify", "Ask the user a guided question"],
                      ["run_code", "Programmatic tool invocation"],
                    ].map(([tool, effect]) => (
                      <tr key={tool} className="border-b border-border/40 last:border-b-0">
                        <td className="px-4 py-2.5 text-foreground/90">{tool}</td>
                        <td className="px-4 py-2.5">{effect}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                File writes are byte-verified after the write, and an empty write never
                satisfies a task-completion gate. A tool result that claims success
                without a real effect is not accepted as proof.
              </p>
            </Section>

            <Section id="update-channels" title="Update channels">
              <p>
                The desktop app checks electron-builder metadata and never applies an
                update on its own. Detection, download, and install are three separate
                user-visible steps.
              </p>
              <ul className="ml-5 list-disc space-y-1.5">
                <li>
                  <Code>stable</Code> resolves to <Code>latest.yml</Code>.
                </li>
                <li>
                  <Code>beta</Code> resolves to <Code>latest-beta.yml</Code> and enables
                  prereleases.
                </li>
                <li>
                  A custom feed URL is only honoured when it ends in{" "}
                  <Code>latest.yml</Code> or <Code>latest-beta.yml</Code>; anything else
                  falls back to the GitHub provider.
                </li>
                <li>
                  Installation requires the release to carry <Code>latest.yml</Code> and
                  the <Code>.blockmap</Code>. Both are uploaded by the release workflow.
                </li>
              </ul>
              <p>
                Windows builds are unsigned, so SmartScreen will prompt on first run of
                a downloaded installer.
              </p>
            </Section>

            <Section id="errors" title="Errors">
              <p>Errors are surfaced as data, never as silent failures:</p>
              <ul className="ml-5 list-disc space-y-1.5">
                <li>
                  Tool failures return a JSON object with an <Code>error</Code> field
                  and often a machine-readable <Code>code</Code>, for example{" "}
                  <Code>INVALID_ARGUMENTS</Code>.
                </li>
                <li>
                  IPC validation failures reject with a schema message naming the invalid
                  field.
                </li>
                <li>
                  Web tools report provider failures with a code such as{" "}
                  <Code>WEB_PROVIDER_ERROR</Code> or <Code>WEB_ABORTED</Code>.
                </li>
                <li>
                  An update that fails to download clears the ready state rather than
                  offering to install a package that never landed.
                </li>
              </ul>
              <p>
                External content fetched by the agent is wrapped in an untrusted-data
                notice so provider text is never treated as instructions.
              </p>
            </Section>

            <div className="mt-10 text-center">
              <Link
                href="/docs"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                &larr; Back to documentation
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
