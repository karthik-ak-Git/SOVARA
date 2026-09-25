import type { Metadata } from "next"
import { Navbar } from "@/components/site/navbar"
import { Footer } from "@/components/site/footer"
import { DocsSidebar, docSections } from "@/components/docs/docs-sidebar"
import { DocsDownloads } from "@/components/docs/docs-downloads"
import { DocsHighlights } from "@/components/docs/docs-highlights"
import { DocSection } from "@/components/docs/doc-section"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = {
  title: "Documentation — SOVARA",
  description:
    "Technical documentation for SOVARA: architecture, data models, security, sovereignty, hardware profiling and operational guidance.",
}

export default function DocsPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3">
          <span className="font-mono-tech text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Documentation
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            SOVARA Technical Documentation
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Reference material for the architecture, data models, security posture and
            operational behavior of SOVARA 1.1.3.
          </p>
        </div>

        <div className="mt-6">
          <DocsDownloads />
        </div>

        <div className="mt-8">
          <DocsHighlights />
        </div>

        {/* mobile section nav */}
        <div className="mt-8 flex gap-2 overflow-x-auto pb-2 lg:hidden">
          {docSections.map((section) => (
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
          <DocsSidebar />

          <div className="min-w-0 border-t border-border/60 lg:border-t-0">
            <DocSection id="overview" title="Overview">
              <p>
                SOVARA is a Windows desktop workbench (version 1.1.3)
                that runs GGUF models locally, offline by default, with no cloud inference
                dependency and no telemetry.
              </p>
              <p>
                The application is distributed as an Electron .exe for Windows 10/11 x64,
                combining a hardened Chromium renderer, a Node.js main process, a durable local
                session store, and a bundled CUDA-capable llama.cpp runtime.
              </p>
            </DocSection>

            <DocSection id="architecture" title="Architecture">
              <p>The mental model for a request flowing through SOVARA:</p>
              <ul className="ml-4 flex flex-col gap-1 [&>li]:list-disc">
                <li>User</li>
                <li>React Renderer</li>
                <li>Secure IPC using contextBridge + Zod</li>
                <li>Main / AppBackend</li>
                <li>Model / resource / tool ports</li>
                <li>SQLite + JSONL</li>
                <li>Local llama-server on 127.0.0.1</li>
              </ul>
            </DocSection>

            <DocSection id="design-decisions" title="Design Decisions">
              <p>
                Inference is kept on loopback networking (127.0.0.1) rather than a remote
                endpoint, so model execution does not depend on cloud availability or network
                conditions.
              </p>
              <p>
                Hardware-aware routing exists because a single fixed model cannot fit every
                machine — SOVARA profiles the host and adjusts model and quantization choices
                accordingly, with LRU-based eviction to reclaim memory under pressure.
              </p>
              <p>
                Persistence uses SQLite for structured metadata alongside append-only JSONL for
                event history, giving both queryable state and a durable, tamper-evident audit
                trail.
              </p>
            </DocSection>

            <DocSection id="core-components" title="Core Components">
              <ul className="ml-4 flex flex-col gap-1 [&>li]:list-disc">
                <li>AppBackend — coordinates ports, sessions and persistence</li>
                <li>ChatService — manages chat sessions and streaming responses</li>
                <li>AgentOrchestrator — task classification, routing, tool use, audit events</li>
                <li>ModelWorkbench — model lifecycle: load, health check, evict</li>
                <li>ModelRouter — considers capability and VRAM/resource constraints</li>
                <li>TaskClassifier — identifies task type ahead of routing</li>
              </ul>
            </DocSection>

            <DocSection id="data-models" title="Data Models">
              <p>Local persistence stores:</p>
              <ul className="ml-4 flex flex-col gap-1 [&>li]:list-disc">
                <li>Sessions and projects</li>
                <li>Messages</li>
                <li>Token usage</li>
                <li>Model registry</li>
                <li>Routing / audit events</li>
                <li>Settings</li>
              </ul>
              <p>
                Structured metadata is stored in SQLite; execution history is appended to JSONL
                event logs.
              </p>
            </DocSection>

            <DocSection id="integrations" title="Integrations">
              <ul className="ml-4 flex flex-col gap-1 [&>li]:list-disc">
                <li>Hugging Face — model discovery for the Model Explorer</li>
                <li>MCP — add, remove, toggle and probe connected tools/services</li>
                <li>Automatic updates — stable and beta GitHub release channels</li>
                <li>Web/Search infrastructure — supports select agent tool use</li>
              </ul>
            </DocSection>

            <DocSection id="deployment" title="Deployment">
              <p>
                SOVARA is packaged as a Windows .exe (Sovara-Setup-1.1.3-x64.exe). Building locally
                uses <code className="font-mono-tech text-xs text-foreground/85">pnpm build:win</code>.
                No admin privileges are required for normal use beyond filesystem write access to
                the SOVARA data directory.
              </p>
            </DocSection>

            <DocSection id="performance" title="Performance">
              <p>
                SOVARA does not publish fixed benchmark numbers, token-per-second figures, or
                guaranteed throughput. Performance depends on the selected model, quantization,
                and the host&apos;s CPU/GPU/VRAM.
              </p>
              <p>
                The hardware validation pipeline (Detect → Estimate → Validate → Load → Infer →
                Measure) is used to assess fit at runtime rather than rely on static claims.
              </p>
            </DocSection>

            <DocSection id="security" title="Security">
              <ul className="ml-4 flex flex-col gap-1 [&>li]:list-disc">
                <li>sandbox: true</li>
                <li>contextIsolation: true</li>
                <li>nodeIntegration: false</li>
                <li>Content Security Policy</li>
                <li>Navigation guards and window-open restrictions</li>
                <li>Zod validation for IPC messages</li>
                <li>Loopback-only inference networking</li>
              </ul>
            </DocSection>

            <DocSection id="sovereignty" title="Sovereignty">
              <p>
                Offline by default. No telemetry. No analytics SDK. No automatic cloud inference.
              </p>
              <p>
                Network access is limited to explicit supported functions: Hugging Face model
                discovery/download, MCP remote connections, and update checks. SOVARA is not
                described as air-gapped, because these explicit functions may use the network.
              </p>
            </DocSection>

            <DocSection id="renderer-features" title="Renderer Features">
              <p>Built on React 18 + Vite, the renderer surfaces:</p>
              <ul className="ml-4 flex flex-col gap-1 [&>li]:list-disc">
                <li>Chat with streaming responses</li>
                <li>Models — lifecycle and compatibility status</li>
                <li>Explore — Hugging Face model discovery</li>
                <li>Library — download/pause/resume/cancel management</li>
                <li>Agents — orchestration and tool permission control</li>
                <li>Skills — scan, import and enable local skills</li>
                <li>Connections — MCP server management</li>
              </ul>
            </DocSection>

            <DocSection id="hardware-profiling" title="Hardware Profiling">
              <p>
                SOVARA detects CPU, RAM, GPU and VRAM, then estimates whether a given model and
                quantization are likely to fit before loading. When a full GPU fit is not
                possible, SOVARA can fall back to a partial fit or CPU execution.
              </p>
              <p>Pipeline: Detect → Estimate → Validate → Load → Infer → Measure.</p>
            </DocSection>

            <DocSection id="testing" title="Testing">
              <p>
                564 desktop tests cover sovereignty, security, IPC validation, persistence, model
                lifecycle, routing, agent orchestration, Explore, downloads, renderer, updates,
                hardware fit, and web/search infrastructure.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">pnpm --filter @sovara/desktop test</Badge>
                <Badge variant="secondary">pnpm --filter @sovara/desktop typecheck</Badge>
              </div>
            </DocSection>

            <DocSection id="setup-troubleshooting" title="Setup & Troubleshooting">
              <p>Requirements: Node &gt;= 22, pnpm 11.17.0 for development. Users only need Windows x64 to run the packaged application.</p>
              <ul className="ml-4 flex flex-col gap-1 [&>li]:list-disc">
                <li>
                  <code className="font-mono-tech text-xs text-foreground/85">git clone https://github.com/karthik-ak-Git/SOVARA.git</code>
                </li>
                <li>
                  <code className="font-mono-tech text-xs text-foreground/85">pnpm install</code>
                </li>
                <li>
                  <code className="font-mono-tech text-xs text-foreground/85">pnpm dev</code>
                </li>
              </ul>
              <p>
                If GPU/VRAM profiling is unavailable, confirm an NVIDIA driver with nvidia-smi is
                installed — CPU-only operation remains supported without it.
              </p>
            </DocSection>

            <DocSection id="operational-runbook" title="Operational Runbook" last>
              <p>
                On first run, SOVARA may provision its pinned local llama.cpp runtime once, then
                operate offline for local inference. Model downloads, MCP remote connections, and
                update checks are the explicit functions that use network access.
              </p>
              <p>
                Automated test gates for sovereignty and security invariants run locally before
                packaging a release build.
              </p>
            </DocSection>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
