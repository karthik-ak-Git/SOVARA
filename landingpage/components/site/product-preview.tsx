"use client"

import { SectionHeading } from "@/components/site/section-heading"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { PlayCircle, Check } from "lucide-react"

const tabs = [
  {
    value: "chat",
    label: "Chat",
    active: "chat-summarizer.Q4_K_M",
    body: "Streaming responses over loopback inference with live token and VRAM indicators alongside the transcript.",
    rows: ["Session list", "Streaming output", "Token usage"],
  },
  {
    value: "models",
    label: "Models",
    active: "3 models loaded",
    body: "Lifecycle state for every loaded model — OFFLINE, LOADING, ACTIVE, BUSY, EVICTING, FAILED — with LRU eviction.",
    rows: ["Model compatibility", "VRAM status", "Lifecycle state"],
  },
  {
    value: "agents",
    label: "Agents",
    active: "AgentOrchestrator",
    body: "Tool permission controls and an audit timeline for every planning, routing and execution step.",
    rows: ["Tool permission control", "Audit timeline", "Execution trace"],
  },
  {
    value: "connections",
    label: "Connections",
    active: "MCP servers",
    body: "Add, remove, toggle and probe MCP-connected apps and services from a single panel.",
    rows: ["Add / remove server", "Toggle connection", "Probe status"],
  },
]

export function ProductPreview() {
  return (
    <section className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Product"
          title="A DESKTOP WORKBENCH FOR CONTROLLED LOCAL AI"
          description="Chat, Models, Explore, Library, Agents, Skills, Connections and Settings — each surfaced with hardware and audit context."
        />

        <Tabs defaultValue="chat" className="mt-12">
          <TabsList className="mx-auto flex-wrap">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-6">
              <div className="grid grid-cols-1 gap-6 rounded-xl border border-border/60 bg-card p-6 lg:grid-cols-[1fr_1fr] lg:items-center">
                <div className="flex flex-col gap-4">
                  <span className="w-fit rounded-full bg-primary/10 px-3 py-1 font-mono-tech text-xs font-medium text-primary">
                    {tab.active}
                  </span>
                  <p className="text-sm leading-relaxed text-muted-foreground">{tab.body}</p>
                  <ul className="flex flex-col gap-2">
                    {tab.rows.map((row) => (
                      <li key={row} className="flex items-center gap-2 text-sm text-foreground/85">
                        <Check className="size-3.5 shrink-0 text-secure" aria-hidden="true" />
                        {row}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-background/60 p-5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-8 rounded-md bg-secondary/70"
                      style={{ width: `${85 - i * 12}%` }}
                    />
                  ))}
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <div className="mt-10 flex justify-center">
          <Button size="lg" variant="outline">
            <PlayCircle data-icon="inline-start" />
            View product tour
          </Button>
        </div>
      </div>
    </section>
  )
}
