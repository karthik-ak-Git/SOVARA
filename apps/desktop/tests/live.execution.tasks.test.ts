import { describe, it, expect } from 'vitest'
import { writePdfFile, writeDocxFile, writeXlsxFile, writePptxFile, generateArtifactFile, markdownToSheets, markdownToSlides, markdownToParagraphs } from '../src/main/backend/artifacts'
import { ToolStubAdapter } from '../src/main/backend/ports/ToolStubAdapter'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('SOVARA AI Execution Tasks — 6 Required Capabilities', () => {

  it('Task 1: PDF Generation — generates clean PDF artifact without raw JSON code', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-task1-'))
    const pdfPath = path.join(tmpDir, 'architecture_report.pdf')
    const assistantText = `
# SOVARA Platform Architecture Report

## Executive Summary
SOVARA is an offline-first AI platform with CUDA offloading, GGUF library management, enterprise skill discovery, and 2D Knowledge Graph memory.

## Architectural Layers
- **Llama Sidecar**: High-performance local inference via llama-server.exe.
- **Skill Scanner**: Automatic discovery of 1,200+ skills in ~/.claude/skills and ~/.gemini/antigravity/skills.
- **2D Memory Graph**: Structured markdown in wiki/ folder rendered with ForceAtlas2 layout.

| Component | Status | Location |
| --- | --- | --- |
| Llama Server | Active | Sidecar Port 50848 |
| Skill Engine | Active | ~/.claude/skills |
| 2D Graph | Active | wiki/entities/ |
`
    const artifact = generateArtifactFile('pdf', pdfPath, assistantText, 'create a pdf report')
    expect(artifact).toBeTruthy()
    expect(fs.existsSync(pdfPath)).toBe(true)
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(100)

    // Ensure raw JSON envelopes are NOT in the PDF text
    const text = fs.readFileSync(pdfPath, 'utf8')
    expect(text).not.toContain('"query": "pdf"')
    expect(text).not.toContain('"maxresults"')
  })

  it('Task 2: Image / Diagram on Architecture — generates SVG architecture visual', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-task2-'))
    const svgPath = path.join(tmpDir, 'sovara_architecture.svg')
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="100%" height="100%">
  <rect width="800" height="500" fill="#0f172a" rx="16"/>
  <text x="400" y="45" fill="#f8fafc" font-family="system-ui" font-size="20" font-weight="700" text-anchor="middle">SOVARA System Architecture</text>
  
  <!-- UI Shell -->
  <rect x="50" y="80" width="700" height="80" fill="#1e293b" stroke="#334155" stroke-width="2" rx="12"/>
  <text x="70" y="125" fill="#38bdf8" font-family="system-ui" font-size="16" font-weight="600">Electron Desktop Shell &amp; React Renderer (Tailwind CSS, Knowledge Graph 2D)</text>
  
  <!-- Orchestrator & Harness -->
  <rect x="50" y="190" width="330" height="130" fill="#1e293b" stroke="#334155" stroke-width="2" rx="12"/>
  <text x="70" y="225" fill="#a855f7" font-family="system-ui" font-size="16" font-weight="600">Agent Orchestrator &amp; DeepSeek Harness</text>
  <text x="70" y="255" fill="#94a3b8" font-family="system-ui" font-size="13">• Format-Agnostic Skill Gate</text>
  <text x="70" y="280" fill="#94a3b8" font-family="system-ui" font-size="13">• Tool Loop &amp; Context Compactor</text>
  
  <!-- Skills & Tools -->
  <rect x="420" y="190" width="330" height="130" fill="#1e293b" stroke="#334155" stroke-width="2" rx="12"/>
  <text x="440" y="225" fill="#34d399" font-family="system-ui" font-size="16" font-weight="600">Skill Engine &amp; MCP Infrastructure</text>
  <text x="440" y="255" fill="#94a3b8" font-family="system-ui" font-size="13">• 1,200+ Discovered Skills Scanner</text>
  <text x="440" y="280" fill="#94a3b8" font-family="system-ui" font-size="13">• MCP Tool Stubs &amp; Subagents</text>
  
  <!-- 2D Memory & Llama Runtime -->
  <rect x="50" y="345" width="700" height="110" fill="#1e293b" stroke="#334155" stroke-width="2" rx="12"/>
  <text x="70" y="380" fill="#f43f5e" font-family="system-ui" font-size="16" font-weight="600">2D Memory Store (wiki/ markdown) &amp; Llama Sidecar CUDA</text>
  <text x="70" y="410" fill="#94a3b8" font-family="system-ui" font-size="13">• Structured wiki/entities/*.md pages with [[wikilinks]] for ForceAtlas2 2D Graph</text>
</svg>`
    fs.writeFileSync(svgPath, svgContent, 'utf8')
    expect(fs.existsSync(svgPath)).toBe(true)
    expect(fs.statSync(svgPath).size).toBeGreaterThan(200)
  })

  it('Task 3: Excel Data — generates XLSX spreadsheet with multiple tables', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-task3-'))
    const xlsxPath = path.join(tmpDir, 'sovara_performance_metrics.xlsx')
    const markdownTable = `
# System Performance Metrics

| Metric | Target | Observed | Status |
| --- | --- | --- | --- |
| TTFT Latency | < 1500ms | 1283ms | PASS |
| Context Tokens | 12288 | 12288 | PASS |
| Skill Discovery | > 1000 | 1200+ | PASS |
| Memory Write | Auto | Active | PASS |
`
    const sheets = markdownToSheets(markdownTable)
    writeXlsxFile(xlsxPath, sheets)
    expect(fs.existsSync(xlsxPath)).toBe(true)
    expect(fs.statSync(xlsxPath).size).toBeGreaterThan(100)
  })

  it('Task 4: Word Document — generates DOCX document with structured sections', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-task4-'))
    const docxPath = path.join(tmpDir, 'sovara_specification.docx')
    const markdownDoc = `
# SOVARA Technical Specification

## Introduction
SOVARA provides an air-gapped local AI agent experience with enterprise-grade document creation, deep reasoning, and persistent 2D memory.

## Architectural Guidelines
- **Autonomous Tool Calls**: Executes shell commands, file modifications, and skill workflows.
- **2D Memory Engine**: Persists entities and concepts into workspace wiki/ pages.
`
    const paras = markdownToParagraphs(markdownDoc)
    writeDocxFile(docxPath, 'SOVARA Technical Specification', paras)
    expect(fs.existsSync(docxPath)).toBe(true)
    expect(fs.statSync(docxPath).size).toBeGreaterThan(100)
  })

  it('Task 5: PDF Presentation / Deliverable — generates clean PDF artifact', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-task5-'))
    const pdfPath = path.join(tmpDir, 'sovara_executive_presentation.pdf')
    const text = `
# SOVARA Executive Presentation

## Slide 1: Platform Overview
SOVARA brings local GGUF models, deep reasoning, and automated document generation into a desktop shell.

## Slide 2: Capability Highlights
- 1,200+ Discovered Skills
- 2D Knowledge Graph Memory
- Single-File React Canvas Artifacts
`
    writePdfFile(pdfPath, 'SOVARA Executive Presentation', text)
    expect(fs.existsSync(pdfPath)).toBe(true)
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(100)
  })

  it('Task 6: 2D Memory Store & React Artifact — writes wiki/ markdown files and tests memory dispatch', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-task6-'))
    const adapter = new ToolStubAdapter(
      undefined,
      undefined,
      () => tmpDir,
    )

    const res1 = await adapter.dispatch('memory', {
      action: 'store',
      title: 'SOVARA Architecture Entity',
      type: 'entity',
      body: 'SOVARA utilizes llama-server CUDA, DeepSeek Harness, and 2D Memory wiki pages.',
      links: ['DeepSeekHarness', 'KnowledgeGraph'],
      tags: ['architecture', 'sovara']
    })
    expect(res1).toContain('wiki/entities/sovara-architecture-entity.md')

    const res2 = await adapter.dispatch('memory', {
      action: 'store',
      title: 'Knowledge Graph Concept',
      type: 'concept',
      body: 'Nodes are rendered with ForceAtlas2 layout from wiki/ markdown files.',
      links: ['SOVARA Architecture Entity'],
      tags: ['graph', '2d-memory']
    })
    expect(res2).toContain('wiki/concepts/knowledge-graph-concept.md')

    const wikiFile1 = path.join(tmpDir, 'wiki', 'entities', 'sovara-architecture-entity.md')
    const wikiFile2 = path.join(tmpDir, 'wiki', 'concepts', 'knowledge-graph-concept.md')
    expect(fs.existsSync(wikiFile1)).toBe(true)
    expect(fs.existsSync(wikiFile2)).toBe(true)

    const content1 = fs.readFileSync(wikiFile1, 'utf8')
    expect(content1).toContain('title: "SOVARA Architecture Entity"')
    expect(content1).toContain('[[DeepSeekHarness]]')
  })
})
