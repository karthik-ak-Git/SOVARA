import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import {
  Settings,
  Cpu,
  CreditCard,
  SlidersHorizontal,
  MessageSquare,
  Link2,
  Puzzle,
  Globe,
  BookOpen,
  Monitor,
  Server,
  FileText,
  RotateCcw,
  Command,
  X,
  Check,
  ChevronRight,
  Info,
  ExternalLink,
  Shield,
  Plus,
  Trash2,
  Upload,
  RefreshCw,
  Folder,
  FileCode,
  Layers,
  Terminal,
  Copy,
  AlertTriangle,
  Archive,
  MessageCircle,
  Bell,
  Zap,
  ArrowRight,
  Bot,
  HardDrive,
  Download,
} from 'lucide-react'
import {
  getAppSettings,
  setAppSettings,
  checkForUpdatesNow,
  installDownloadedUpdate,
  onUpdateEvent,
  getExecMode,
  setExecMode,
  listSessions,
  listArchivedSessions,
  archiveSession,
  unarchiveSession,
  deleteSession,
  createSession,
  deleteProject,
  listDiscoveredModels,
  listMcpServers,
  addMcpServer,
  removeMcpServer,
  toggleMcpServer,
  probeMcpServer,
  listBionicSkills,
  addBionicSkill,
  removeBionicSkill,
  scanSkills,
  toggleSkillsSource,
  importSkillFromUrl,
  getTotalUsage,
  getUsageByModel,
  getRecentUsage,
  getAppInfo,
  getSystemInfo,
  getRecentLogs,
  pickFolder,
  listTools,
  dispatchTool,
  copyToClipboard,
  getHardwareProfile,
  detectExternalRuntimes,
  getActiveDownloads,
  onDownloadEvents,
  cancelModelDownload,
  type DownloadEventView,
  type AppSettingsState,
  type UpdateCheckView,
  type UpdateEventView,
  type ExecMode,
  type SessionHeaderView,
  type McpServerView,
  type BionicSkillView,
  type SkillsSource,
  type TokenUsage,
  type ModelUsage,
  type RecentUsageRow,
  type AppInfoView,
  type SystemInfoView,
  type ToolDefinitionView,
} from '@/lib/client/api'
import type { DiscoveredModel } from '@shared/types/models'
import type { HardwareInfo } from '@shared/types/explore'
import { ExplorePage } from '@/features/explore/ExplorePage'
import { LibraryPage } from '@/features/library/LibraryPage'
import { LoadedInstancesSection } from '@/features/settings/LoadedInstancesSection'
import { KnowledgeGraph3D } from '@/features/graph/KnowledgeGraph3D'

export type SettingsTabId =
  | 'general'
  | 'notifications'
  | 'agent'
  | 'billing'
  | 'appearance'
  | 'sessions'
  | 'connected-apps'
  | 'skills'
  | 'explore'
  | 'library'
  | 'loaded-instances'
  | 'local-model-api'
  | 'local-model-defaults'
  | 'runtime'
  | 'shortcuts'
  | 'knowledge-graph'
  | `project:${string}`

interface SettingsNavGroup {
  label: string
  items: Array<{ id: SettingsTabId; label: string; icon: ReactElement }>
}

const NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: 'Settings',
    items: [
      { id: 'general', label: 'General', icon: <Settings size={15} /> },
      { id: 'notifications', label: 'Notifications & Hardware', icon: <Bell size={15} /> },
      { id: 'agent', label: 'Agent', icon: <Cpu size={15} /> },
      { id: 'billing', label: 'Usage', icon: <CreditCard size={15} /> },
      { id: 'appearance', label: 'Preferences', icon: <SlidersHorizontal size={15} /> },
      { id: 'sessions', label: 'Sessions', icon: <MessageSquare size={15} /> },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { id: 'connected-apps', label: 'Connected Apps', icon: <Link2 size={15} /> },
      { id: 'skills', label: 'Skills', icon: <Puzzle size={15} /> },
    ],
  },
  {
    label: 'Local Models',
    items: [
      { id: 'explore', label: 'Explore', icon: <Globe size={15} /> },
      { id: 'library', label: 'Library', icon: <BookOpen size={15} /> },
      { id: 'loaded-instances', label: 'Loaded Instances', icon: <Monitor size={15} /> },
      { id: 'local-model-api', label: 'Local Model API', icon: <Server size={15} /> },
      { id: 'local-model-defaults', label: 'Local Model Defaults', icon: <FileText size={15} /> },
      { id: 'runtime', label: 'Runtime & System', icon: <RotateCcw size={15} /> },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'knowledge-graph', label: 'Knowledge Graph 3D', icon: <Layers size={15} /> },
    ],
  },
]

interface McpPreset {
  id: string
  name: string
  provider: string
  command: string
  description: string
}

const DEFAULT_ALLOWED_DOMAINS = [
  '*.github.com',
  '*.hf.co',
  '*.npmjs.com',
  'developer.mozilla.org',
  'raw.githubusercontent.com',
]

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  initialSection?: string
  initialProjectId?: string | null
  projects?: Array<{ id: string; name: string; rootPath?: string; sessions?: Array<{ id: string; title: string }> }>
  activeProjectId?: string | null
  onSelectProject?: (id: string) => void
  onSelectSession?: (id: string) => void
  onRefreshProjects?: () => void
  execMode?: ExecMode
  onExecModeChange?: (mode: ExecMode) => void
  onOpenExplorer?: () => void
}

export function SettingsModal({
  open,
  onClose,
  initialSection = 'general',
  initialProjectId = null,
  projects = [],
  activeProjectId = null,
  onSelectProject,
  onSelectSession,
  onRefreshProjects,
  execMode: initialExecMode = 'ask',
  onExecModeChange,
  onOpenExplorer,
}: SettingsModalProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general')
  const [appSettings, setAppSettingsState] = useState<AppSettingsState | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfoView | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfoView | null>(null)

  // Hardware Profile, External Runtimes & Model Downloads
  const [hwProfile, setHwProfile] = useState<HardwareInfo | null>(null)
  const [runtimeSummary, setRuntimeSummary] = useState<any>(null)
  const [activeDownloads, setActiveDownloads] = useState<Record<string, DownloadEventView>>({})

  // Execution & General controls — all backend-synced through
  // getAppSettings/setAppSettings (single source of truth).
  const [execMode, setLocalExecMode] = useState<ExecMode>(initialExecMode)
  const [queuedMessagesMode, setQueuedMessagesMode] = useState<'queue' | 'send'>('send')
  const [securityPreset, setSecurityPreset] = useState<string>('default')
  const [reviewPolicy, setReviewPolicy] = useState<string>('always-ask')
  const [toolPermissionsOpen, setToolPermissionsOpen] = useState(false)
  const [networkRulesOpen, setNetworkRulesOpen] = useState(false)
  const [allowedDomains, setAllowedDomains] = useState<string[]>(DEFAULT_ALLOWED_DOMAINS)
  const [newDomainInput, setNewDomainInput] = useState('')

  // Local model defaults & reasoning state (backend-synced; defaults match backend)
  const [reasoningEnabled, setReasoningEnabled] = useState<boolean>(true)
  const [contextLength, setContextLength] = useState<number>(8192)
  const [gpuLayers, setGpuLayers] = useState<number>(99)
  const [flashAttention, setFlashAttention] = useState<boolean>(true)

  // Updates & Feeds
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckView | null>(null)
  const [updateEvent, setUpdateEvent] = useState<UpdateEventView | null>(null)
  const [feedDraft, setFeedDraft] = useState<string | null>(null)

  // Sessions: Both Active & Archived
  const [activeSessions, setActiveSessions] = useState<SessionHeaderView[]>([])
  const [archivedSessions, setArchivedSessions] = useState<SessionHeaderView[]>([])
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)

  // Token Usage & Billing
  const [totalUsage, setTotalUsage] = useState<TokenUsage>({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([])
  const [recentUsage, setRecentUsage] = useState<RecentUsageRow[]>([])

  // Connected Apps / MCP
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([])
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false)
  const [mcpDialogPreset, setMcpDialogPreset] = useState<McpPreset | null>(null)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [mcpForm, setMcpForm] = useState<{
    name: string
    provider: string
    transport: 'stdio' | 'http'
    command: string
    endpoint: string
  }>({
    name: '',
    provider: '',
    transport: 'stdio',
    command: '',
    endpoint: '',
  })

  // Skills
  const [skillsSources, setSkillsSources] = useState<SkillsSource[]>([])
  const [bionicSkills, setBionicSkills] = useState<BionicSkillView[]>([])
  const [skillDialogOpen, setSkillDialogOpen] = useState(false)
  const [skillForm, setSkillForm] = useState({ name: '', description: '', content: '' })
  const [skillError, setSkillError] = useState<string | null>(null)
  const [skillImportUrl, setSkillImportUrl] = useState('')
  const [skillImporting, setSkillImporting] = useState(false)

  // Agent & Tools
  const [agentModels, setAgentModels] = useState<DiscoveredModel[]>([])
  const [agentTools, setAgentTools] = useState<ToolDefinitionView[]>([])
  const [instructionsDraft, setInstructionsDraft] = useState<string>('')
  const [testingSearch, setTestingSearch] = useState(false)
  const [searchTestResult, setSearchTestResult] = useState<string | null>(null)

  // Local Model API & Logs
  const [apiRecentLogs, setApiRecentLogs] = useState<Record<string, string[]>>({})

  // Project Deletion Confirmation
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null)

  // Copied path notification
  const [copiedPath, setCopiedPath] = useState(false)

  const modalRef = useRef<HTMLDivElement>(null)

  // Sync initial tab when opened
  useEffect(() => {
    if (open) {
      if (initialProjectId) {
        setActiveTab(`project:${initialProjectId}`)
      } else if (initialSection) {
        setActiveTab((initialSection as SettingsTabId) || 'general')
      }
    }
  }, [open, initialSection, initialProjectId])

  const refreshSessionsData = useCallback(() => {
    listSessions().then(setActiveSessions).catch(() => {})
    listArchivedSessions().then(setArchivedSessions).catch(() => {})
  }, [])

  // Load all actual configured settings and system info on open
  useEffect(() => {
    if (!open) return

    getAppInfo().then(setAppInfo).catch(() => {})
    getSystemInfo().then(setSystemInfo).catch(() => {})

    getAppSettings()
      .then((s) => {
        setAppSettingsState(s)
        setInstructionsDraft(s.customInstructions ?? '')
        // Backend is the source of truth for every control below.
        setReviewPolicy(s.reviewPolicy ?? 'always-ask')
        setQueuedMessagesMode(s.queuedMessagesMode ?? 'send')
        if (Array.isArray(s.allowedDomains) && s.allowedDomains.length > 0) setAllowedDomains(s.allowedDomains)
        setReasoningEnabled(s.reasoningEnabled ?? true)
        if (typeof s.contextLength === 'number') setContextLength(s.contextLength)
        if (typeof s.gpuLayers === 'number') setGpuLayers(s.gpuLayers)
        setFlashAttention(s.flashAttention ?? true)
      })
      .catch(() => {})

    getExecMode()
      .then((m) => {
        setLocalExecMode(m)
        if (m === 'allow') setSecurityPreset('permissive')
        else if (m === 'review') setSecurityPreset('strict')
        else setSecurityPreset('default')
      })
      .catch(() => {})

    refreshSessionsData()
    listMcpServers().then(setMcpServers).catch(() => {})
    listBionicSkills().then(setBionicSkills).catch(() => {})
    scanSkills().then(setSkillsSources).catch(() => {})
    getTotalUsage().then(setTotalUsage).catch(() => {})
    getUsageByModel().then(setModelUsage).catch(() => {})
    getRecentUsage().then(setRecentUsage).catch(() => {})
    listDiscoveredModels().then(setAgentModels).catch(() => {})
    listTools().then(setAgentTools).catch(() => {})
    getRecentLogs('all').then(setApiRecentLogs).catch(() => {})

    void getHardwareProfile().then(setHwProfile).catch(() => {})
    void detectExternalRuntimes().then(setRuntimeSummary).catch(() => {})
    void getActiveDownloads().then((dls) => {
      if (Array.isArray(dls)) {
        const map: Record<string, DownloadEventView> = {}
        for (const dl of dls) {
          map[`${dl.modelId}\n${dl.rfilename}`] = dl as DownloadEventView
        }
        setActiveDownloads(map)
      }
    }).catch(() => {})

    const disposeDownloads = onDownloadEvents((ev) => {
      setActiveDownloads((prev) => {
        const next = { ...prev }
        const key = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'cancelled') {
          delete next[key]
        } else {
          next[key] = ev
        }
        return next
      })
    })

    return () => {
      disposeDownloads()
    }
  }, [open, refreshSessionsData])

  useEffect(() => onUpdateEvent((event) => {
    setUpdateEvent(event)
    if (event.status === 'current' || event.status === 'available' || event.status === 'error') {
      setUpdateResult({
        status: event.status === 'error' ? 'error' : event.status === 'current' ? 'current' : 'available',
        current: event.current,
        latest: event.latest,
        message: event.message,
      })
    }
  }), [])

  const hwRamGB = hwProfile ? Math.round(hwProfile.totalRamMB / 1024) : 16
  const hwFreeRamGB = hwProfile ? (hwProfile.freeRamMB / 1024).toFixed(1) : '8.0'
  const hwVramGB = hwProfile?.totalVramMB ? (hwProfile.totalVramMB / 1024).toFixed(1) : undefined
  const hwStorageFree = hwProfile?.storageFreeGB !== undefined ? `${hwProfile.storageFreeGB} GB` : undefined
  const hwStorageTotal = hwProfile?.storageTotalGB !== undefined ? `${hwProfile.storageTotalGB} GB` : undefined

  const hwRecommendation = (() => {
    if (!hwProfile) return { tier: 'Detecting Hardware…', desc: 'Analyzing system capabilities…', badgeClass: 'sv-hw-badge--neutral' }
    if (hwProfile.gpuAvailable && (hwProfile.totalVramMB ?? 0) >= 7500) {
      return {
        tier: 'High Performance GPU',
        desc: 'Up to 8B–14B models (Llama 3.1 8B, Qwen 2.5 7B, Mistral 7B) fit in VRAM with full GPU offload.',
        badgeClass: 'sv-hw-badge--success',
      }
    }
    if (hwProfile.gpuAvailable && (hwProfile.totalVramMB ?? 0) >= 3000) {
      return {
        tier: 'Dedicated GPU Accelerated',
        desc: 'Compact 1B–4B models (Llama 3.2 3B, Qwen 2.5 3B, SmolLM2) offload with high tokens/sec.',
        badgeClass: 'sv-hw-badge--accent',
      }
    }
    return {
      tier: 'System RAM / CPU Mode',
      desc: 'Lightweight models (SmolLM2 135M/360M, Llama 3.2 1B, Qwen 0.5B/1.5B) run smoothly in system memory.',
      badgeClass: 'sv-hw-badge--neutral',
    }
  })()

  const handleNavigateExplorer = () => {
    setActiveTab('explore')
  }

  const activeDlList = Object.values(activeDownloads)
  const activeDlCount = activeDlList.length
  const ollamaOnline = runtimeSummary?.ollama?.online ?? false
  const lmOnline = runtimeSummary?.lmstudio?.online ?? false
  const totalLocalModels = runtimeSummary?.totalLocalModels ?? 0

  const handleCancelDownload = (modelId: string, rfilename: string) => {
    void cancelModelDownload(modelId, rfilename).then(() => {
      setActiveDownloads((prev) => {
        const next = { ...prev }
        delete next[`${modelId}\n${rfilename}`]
        return next
      })
    })
  }

  // Handle escape key
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (toolPermissionsOpen) {
          setToolPermissionsOpen(false)
        } else if (networkRulesOpen) {
          setNetworkRulesOpen(false)
        } else if (mcpDialogOpen) {
          setMcpDialogOpen(false)
        } else if (skillDialogOpen) {
          setSkillDialogOpen(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, toolPermissionsOpen, networkRulesOpen, mcpDialogOpen, skillDialogOpen, onClose])

  const applyPatch = useCallback(async (patch: Partial<AppSettingsState>): Promise<void> => {
    try {
      const updated = await setAppSettings(patch)
      setAppSettingsState(updated)
      if (patch.sidebarBackground) {
        document.documentElement.setAttribute('data-sidebar', patch.sidebarBackground)
      }
      if (patch.inlineDiffLayout) {
        document.documentElement.setAttribute('data-diff', patch.inlineDiffLayout)
      }
    } catch (e) {
      console.error('[SettingsModal] applyPatch error:', e)
    }
  }, [])

  const handleExecModeChange = useCallback(
    (mode: ExecMode) => {
      setLocalExecMode(mode)
      onExecModeChange?.(mode)
      void setExecMode(mode).catch(() => {})
    },
    [onExecModeChange]
  )

  const handleCheckUpdates = useCallback(async () => {
    setCheckingUpdate(true)
    try {
      const res = await checkForUpdatesNow()
      setUpdateResult(res)
    } catch {
      setUpdateResult({
        status: 'error',
        current: appSettings?.version ?? appInfo?.version ?? '1.1.1',
        latest: null,
        message: 'Failed to connect to update feed.',
      })
    } finally {
      setCheckingUpdate(false)
    }
  }, [appSettings?.version, appInfo?.version])

  // Chat Actions
  const handleOpenChat = useCallback(
    (sessionId: string) => {
      onSelectSession?.(sessionId)
      onClose()
    },
    [onSelectSession, onClose]
  )

  const handleArchiveChat = useCallback(
    async (sessionId: string) => {
      try {
        await archiveSession(sessionId)
        refreshSessionsData()
      } catch (e) {
        console.error('[SettingsModal] archiveSession error:', e)
      }
    },
    [refreshSessionsData]
  )

  const handleUnarchiveChat = useCallback(
    async (sessionId: string) => {
      try {
        await unarchiveSession(sessionId)
        refreshSessionsData()
      } catch (e) {
        console.error('[SettingsModal] unarchiveSession error:', e)
      }
    },
    [refreshSessionsData]
  )

  const handleDeleteChat = useCallback(
    async (sessionId: string) => {
      try {
        await deleteSession(sessionId)
        setDeletingSessionId(null)
        refreshSessionsData()
      } catch (e) {
        console.error('[SettingsModal] deleteSession error:', e)
      }
    },
    [refreshSessionsData]
  )

  const handleCreateProjectChat = useCallback(
    async (projectId: string) => {
      try {
        const s = await createSession('New Session', projectId)
        refreshSessionsData()
        onSelectSession?.(s.id)
        onClose()
      } catch (e) {
        console.error('[SettingsModal] createSession error:', e)
      }
    },
    [refreshSessionsData, onSelectSession, onClose]
  )

  // Project Deletion
  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      try {
        await deleteProject(projectId)
        setConfirmDeleteProjectId(null)
        onRefreshProjects?.()
        setActiveTab('general')
      } catch (e) {
        console.error('[SettingsModal] deleteProject error:', e)
      }
    },
    [onRefreshProjects]
  )

  // MCP Actions
  const openAddMcpDialog = useCallback((preset: McpPreset | null) => {
    setMcpError(null)
    setMcpDialogPreset(preset)
    if (preset) {
      setMcpForm({
        name: preset.name,
        provider: preset.provider,
        transport: 'stdio',
        command: preset.command,
        endpoint: '',
      })
    } else {
      setMcpForm({ name: '', provider: '', transport: 'stdio', command: '', endpoint: '' })
    }
    setMcpDialogOpen(true)
  }, [])

  const handleAddMcp = useCallback(async () => {
    setMcpError(null)
    const name = mcpForm.name.trim()
    if (!name) {
      setMcpError('Name is required')
      return
    }
    try {
      const created = await addMcpServer({
        name,
        provider: mcpForm.provider.trim() || 'Custom',
        transport: mcpForm.transport,
        ...(mcpForm.transport === 'stdio'
          ? { command: mcpForm.command.trim() }
          : { endpoint: mcpForm.endpoint.trim() }),
      })
      setMcpDialogOpen(false)
      setMcpServers((prev) => [created, ...prev.filter((p) => p.id !== created.id)])
      try {
        const probed = await probeMcpServer(created.id)
        setMcpServers((prev) => prev.map((s) => (s.id === probed.id ? probed : s)))
      } catch {
        void listMcpServers().then(setMcpServers)
      }
    } catch (e) {
      setMcpError(e instanceof Error ? e.message : String(e))
    }
  }, [mcpForm])

  const handleRemoveMcp = useCallback(async (id: string) => {
    try {
      await removeMcpServer(id)
      setMcpServers((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      console.error('[SettingsModal] removeMcpServer error:', e)
    }
  }, [])

  const handleToggleMcp = useCallback(async (id: string, enabled: boolean) => {
    try {
      const updated = await toggleMcpServer(id, enabled)
      setMcpServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (e) {
      console.error('[SettingsModal] toggleMcpServer error:', e)
    }
  }, [])

  const handleProbeMcp = useCallback(async (id: string) => {
    try {
      const probed = await probeMcpServer(id)
      setMcpServers((prev) => prev.map((s) => (s.id === id ? probed : s)))
    } catch (e) {
      console.error('[SettingsModal] probeMcpServer error:', e)
    }
  }, [])

  // Skills Actions
  const handleAddSkill = useCallback(async () => {
    setSkillError(null)
    const name = skillForm.name.trim()
    const content = skillForm.content.trim()
    if (!name) {
      setSkillError('Skill name is required')
      return
    }
    if (!content) {
      setSkillError('Instructions are required')
      return
    }
    try {
      await addBionicSkill({ name, description: skillForm.description.trim(), content })
      setSkillDialogOpen(false)
      setSkillForm({ name: '', description: '', content: '' })
      const updated = await listBionicSkills()
      setBionicSkills(updated)
    } catch (e) {
      setSkillError(e instanceof Error ? e.message : String(e))
    }
  }, [skillForm])

  const handleRemoveSkill = useCallback(async (name: string) => {
    try {
      await removeBionicSkill(name)
      setBionicSkills((prev) => prev.filter((s) => s.name !== name))
    } catch (e) {
      console.error('[SettingsModal] removeBionicSkill error:', e)
    }
  }, [])

  const handleScanSkills = useCallback(async () => {
    try {
      const sources = await scanSkills()
      setSkillsSources(sources)
      const bionic = await listBionicSkills()
      setBionicSkills(bionic)
    } catch (e) {
      console.error('[SettingsModal] scanSkills error:', e)
    }
  }, [])

  const handleToggleSkillSource = useCallback(async (name: string, enabled: boolean) => {
    try {
      await toggleSkillsSource(name, enabled)
      setSkillsSources((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)))
    } catch (e) {
      console.error('[SettingsModal] toggleSkillsSource error:', e)
    }
  }, [])

  const handleSkillUrlImport = useCallback(async () => {
    const url = skillImportUrl.trim()
    if (!url) {
      setSkillError('URL is required')
      return
    }
    setSkillImporting(true)
    setSkillError(null)
    try {
      await importSkillFromUrl(url)
      setSkillImportUrl('')
      const bionic = await listBionicSkills()
      setBionicSkills(bionic)
    } catch (e) {
      setSkillError(e instanceof Error ? e.message : String(e))
    } finally {
      setSkillImporting(false)
    }
  }, [skillImportUrl])

  const runSearchTest = useCallback(async () => {
    setTestingSearch(true)
    setSearchTestResult(null)
    try {
      const res = await dispatchTool('web_search', { queries: ['current date and time'] })
      if (res.blocked) {
        setSearchTestResult(`Blocked: ${res.message ?? res.reason ?? 'Permission denied'}`)
      } else if (res.result !== undefined) {
        setSearchTestResult(`OK — ${res.result.slice(0, 180)}${res.result.length > 180 ? '…' : ''}`)
      } else {
        setSearchTestResult('No result returned.')
      }
    } catch (e) {
      setSearchTestResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTestingSearch(false)
    }
  }, [])

  const handleRefreshLogs = useCallback(async () => {
    try {
      const logs = await getRecentLogs('all')
      setApiRecentLogs(logs)
    } catch (e) {
      console.error('[SettingsModal] getRecentLogs error:', e)
    }
  }, [])

  if (!open) return null

  const displayProjects = projects.filter((p) => p.id !== '__global__')
  const totalToolsCount = agentTools.length > 0 ? agentTools.length : 12

  return (
    <div
      className="settings-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={modalRef}
        className="settings-modal-window"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Application Settings"
      >
        {/* Close Button Top-Right */}
        <button
          type="button"
          className={`settings-modal-close-btn ${activeTab === 'explore' ? 'settings-modal-close-btn--explorer' : ''}`}
          onClick={onClose}
          aria-label="Close settings"
          title="Close (Esc)"
        >
          <X size={17} />
        </button>

        {/* Left Sidebar Navigation */}
        <aside className="settings-modal-sidebar">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="settings-modal-nav-group">
              <div className="settings-modal-nav-header">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-modal-nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <span className="settings-modal-nav-icon">{item.icon}</span>
                  <span className="settings-modal-nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}

          {/* Projects Group */}
          {displayProjects.length > 0 ? (
            <div className="settings-modal-nav-group">
              <div className="settings-modal-nav-header">Workspaces</div>
              {displayProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`settings-modal-nav-item ${activeTab === `project:${p.id}` ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab(`project:${p.id}`)
                    onSelectProject?.(p.id)
                  }}
                >
                  <span className="settings-modal-nav-icon"><Folder size={15} /></span>
                  <span className="settings-modal-nav-label">{p.name}</span>
                </button>
              ))}
            </div>
          ) : null}

          {/* Shortcuts Group */}
          <div className="settings-modal-nav-group">
            <div className="settings-modal-nav-header">Shortcuts</div>
            <button
              type="button"
              className={`settings-modal-nav-item ${activeTab === 'shortcuts' ? 'active' : ''}`}
              onClick={() => setActiveTab('shortcuts')}
            >
              <span className="settings-modal-nav-icon"><Command size={15} /></span>
              <span className="settings-modal-nav-label">Keyboard Shortcuts</span>
            </button>
          </div>

          {/* Sidebar Footer: Sovereign Node Status (No user profile / login) */}
          <div className="settings-modal-sidebar-footer">
            <div className="settings-modal-sovereign-status">
              <span className="settings-sovereign-indicator" />
              <div className="settings-sovereign-meta">
                <span className="settings-sovereign-label">Sovereign Node</span>
                <span className="settings-sovereign-sub">100% Local • Private</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="settings-modal-main">
          {/* GENERAL TAB */}
          {activeTab === 'general' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">General</h1>
                <p className="settings-modal-subtitle">
                  Configure execution permissions, update channels, and sovereign workspace storage.
                </p>
              </div>

              {/* Execution Group */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Execution</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Queued Messages</div>
                      <div className="settings-modal-row-desc">
                        Configure when follow-up messages are sent during generation.
                      </div>
                      <div
                        className="settings-modal-row-sublink"
                        onClick={() => setActiveTab('shortcuts')}
                      >
                        Keyboard shortcuts <Info size={11} />
                      </div>
                    </div>
                    <div className="settings-segmented-group">
                      <button
                        type="button"
                        className={`settings-segmented-btn ${queuedMessagesMode === 'queue' ? 'active' : ''}`}
                        onClick={() => {
                          setQueuedMessagesMode('queue')
                          void applyPatch({ queuedMessagesMode: 'queue' })
                        }}
                      >
                        Queue
                      </button>
                      <button
                        type="button"
                        className={`settings-segmented-btn ${queuedMessagesMode === 'send' ? 'active' : ''}`}
                        onClick={() => {
                          setQueuedMessagesMode('send')
                          void applyPatch({ queuedMessagesMode: 'send' })
                        }}
                      >
                        Send Immediately
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Global Permissions Group */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Global Permissions</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Security Preset</div>
                      <div className="settings-modal-row-desc">
                        Controls autonomous actions across workspaces. Current mode:{' '}
                        <strong>{securityPreset === 'permissive' ? 'Permissive (Auto-Run)' : securityPreset === 'strict' ? 'Strict (Review All)' : 'Default (Ask Each Time)'}</strong>.
                      </div>
                      <div
                        className="settings-modal-row-sublink"
                        onClick={() => setToolPermissionsOpen(true)}
                      >
                        Learn more about {securityPreset === 'default' ? 'Default' : securityPreset} <Info size={11} />
                      </div>
                    </div>
                    <div>
                      <select
                        className="settings-select-pill"
                        value={securityPreset}
                        onChange={(e) => {
                          const val = e.target.value
                          setSecurityPreset(val)
                          if (val === 'permissive') handleExecModeChange('allow')
                          else if (val === 'strict') handleExecModeChange('review')
                          else handleExecModeChange('ask')
                        }}
                      >
                        <option value="default">Default (Ask Each Time)</option>
                        <option value="permissive">Permissive (Auto-Run)</option>
                        <option value="strict">Strict (Review All)</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label-wrap">
                        <span className="settings-modal-row-label">Tool Permissions</span>
                        <span className="settings-count-badge">{totalToolsCount}</span>
                      </div>
                      <div className="settings-modal-row-desc">
                        Inspect registered tools for filesystem editing, terminal execution, search, and MCP plugins.
                      </div>
                    </div>
                    <div>
                      <button
                        type="button"
                        className="settings-btn-action"
                        onClick={() => setToolPermissionsOpen(true)}
                      >
                        Configure
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Agent Behavior Group */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Agent Behavior</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Artifact Review Policy</div>
                      <div className="settings-modal-row-desc">
                        Whether the agent requests explicit user review before modifying code and documents.
                        Synced through backend settings.
                      </div>
                    </div>
                    <div>
                      <select
                        className="settings-select-pill"
                        value={reviewPolicy}
                        onChange={(e) => {
                          const val = e.target.value as 'always-ask' | 'auto-approve' | 'never-ask'
                          setReviewPolicy(val)
                          void applyPatch({ reviewPolicy: val, customAutoReview: val === 'auto-approve' })
                        }}
                      >
                        <option value="always-ask">Always Ask</option>
                        <option value="auto-approve">Auto-Approve Safe</option>
                        <option value="never-ask">Never Ask</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Network Permissions Group */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Network Permissions</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Network Access Rules</div>
                      <div className="settings-modal-row-desc">
                        Configure allowed external endpoints for web reading and API integration ({allowedDomains.length} active rules).
                      </div>
                    </div>
                    <div>
                      <button
                        type="button"
                        className="settings-btn-action"
                        onClick={() => setNetworkRulesOpen(true)}
                      >
                        Configure
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* App & Updates Group */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">App &amp; Updates</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">App Version</div>
                      <div className="settings-modal-row-desc">
                        Sovara desktop sovereign runtime engine.
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="settings-info-chip">{appInfo?.version ?? appSettings?.version ?? '1.1.1'}</span>
                      <span className="settings-info-badge">
                        {appSettings?.updateChannel === 'beta' ? 'Beta' : 'Stable'}
                      </span>
                    </div>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Automatic Updates</div>
                      <div className="settings-modal-row-desc">
                        Check at startup and every 6 hours, download verified updates in the background, and restart only when you choose.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`settings-toggle ${appSettings?.autoUpdates ?? true ? 'settings-toggle--on' : ''}`}
                      onClick={() => void applyPatch({ autoUpdates: !(appSettings?.autoUpdates ?? true) })}
                      role="switch"
                      aria-checked={appSettings?.autoUpdates ?? true}
                    >
                      <span className="settings-toggle-thumb" />
                    </button>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Update Channel</div>
                      <div className="settings-modal-row-desc">
                        Choose between tested stable releases and early preview beta builds.
                      </div>
                    </div>
                    <select
                      className="settings-select-pill"
                      value={appSettings?.updateChannel ?? 'stable'}
                      onChange={(e) => void applyPatch({ updateChannel: e.target.value as 'stable' | 'beta' })}
                    >
                      <option value="stable">Stable</option>
                      <option value="beta">Beta (Early Access)</option>
                    </select>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Check for Updates</div>
                      <div className="settings-modal-row-desc">
                        {updateEvent?.message ??
                          updateResult?.message ??
                          (appSettings?.lastUpdateCheckAt
                            ? `Last checked ${new Date(appSettings.lastUpdateCheckAt).toLocaleTimeString()}`
                            : 'Sovara checks at startup and every 6 hours when enabled.')}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="settings-btn-action"
                      onClick={() => void handleCheckUpdates()}
                      disabled={checkingUpdate}
                    >
                      {checkingUpdate || updateEvent?.status === 'checking' ? (
                        <>
                          <RefreshCw size={13} className="spin" />
                          <span>Checking…</span>
                        </>
                      ) : (
                        'Check Now'
                      )}
                    </button>
                  </div>

                  {updateEvent?.status === 'downloaded' ? (
                    <div className="settings-modal-row">
                      <div className="settings-modal-row-info">
                        <div className="settings-modal-row-label">Update Ready</div>
                        <div className="settings-modal-row-desc">{updateEvent.message}</div>
                      </div>
                      <button
                        type="button"
                        className="settings-btn-action"
                        onClick={() => void installDownloadedUpdate()}
                      >
                        Restart &amp; Install
                      </button>
                    </div>
                  ) : null}

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Update Feed URL</div>
                      <div className="settings-modal-row-desc">
                        Optional electron-builder latest.yml URL. Leave the default GitHub Releases feed for automatic NSIS updates.
                      </div>
                    </div>
                  </div>
                  <div className="settings-modal-row" style={{ paddingTop: 0 }}>
                    <input
                      className="settings-input"
                      type="url"
                      placeholder="https://github.com/karthik-ak-Git/SOVARA/releases/latest/download/latest.yml"
                      value={feedDraft ?? appSettings?.updateFeedUrl ?? ''}
                      onChange={(e) => setFeedDraft(e.target.value)}
                      onBlur={() => {
                        if (feedDraft !== null && feedDraft !== (appSettings?.updateFeedUrl ?? '')) {
                          void applyPatch({ updateFeedUrl: feedDraft })
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Workspace Group */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Workspace</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Global Workspace Folder</div>
                      <div className="settings-modal-row-desc" style={{ wordBreak: 'break-all' }}>
                        {appSettings?.globalWorkspaceRoot || 'Auto-configured in user data directory'}
                      </div>
                      <div className="settings-modal-row-desc" style={{ marginTop: 2 }}>
                        Default directory for standalone sessions, downloads, and sovereign MCP tool scratchpads.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="settings-btn-action"
                      onClick={async () => {
                        const picked = await pickFolder()
                        if (!picked.canceled && picked.filePath) {
                          void applyPatch({ globalWorkspaceRoot: picked.filePath })
                        }
                      }}
                    >
                      Change Folder
                    </button>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Session Notifications</div>
                      <div className="settings-modal-row-desc">
                        Show an OS notification when an agent finishes generation while Sovara is in the background.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`settings-toggle ${appSettings?.sessionNotifications ?? true ? 'settings-toggle--on' : ''}`}
                      onClick={() => void applyPatch({ sessionNotifications: !(appSettings?.sessionNotifications ?? true) })}
                      role="switch"
                      aria-checked={appSettings?.sessionNotifications ?? true}
                    >
                      <span className="settings-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* NOTIFICATIONS & HARDWARE TAB */}
          {activeTab === 'notifications' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Notifications &amp; Hardware</h1>
                <p className="settings-modal-subtitle">
                  Real-time PC hardware capabilities, tailored model suggestions, active downloads, and alert preferences.
                </p>
              </div>

              {/* Hardware Profile & Tailored Suggestions */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Hardware Profile &amp; Model Suggestions</div>
                <div className="settings-modal-card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Zap size={18} color="#C65D3B" />
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1A1614' }}>
                        {hwProfile?.gpuAvailable && hwProfile.gpuName ? hwProfile.gpuName : 'System CPU Inference'}
                      </span>
                    </div>
                    <span className={`sv-hw-badge ${hwRecommendation.badgeClass}`}>
                      {hwRecommendation.tier}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
                    <div style={{ padding: '10px 12px', background: '#FAF8F5', borderRadius: 8, border: '1px solid #EAE5DE' }}>
                      <div style={{ fontSize: 11, color: '#6B635B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>GPU Acceleration</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1614', marginTop: 4 }}>
                        {hwProfile?.gpuAvailable ? 'Available' : 'CPU Only'}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B635B', marginTop: 2 }}>
                        {hwVramGB ? `${hwVramGB} GB VRAM` : 'Shared System RAM'}
                      </div>
                    </div>

                    <div style={{ padding: '10px 12px', background: '#FAF8F5', borderRadius: 8, border: '1px solid #EAE5DE' }}>
                      <div style={{ fontSize: 11, color: '#6B635B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>System Memory</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1614', marginTop: 4 }}>
                        {hwRamGB} GB Total
                      </div>
                      <div style={{ fontSize: 11, color: '#10B981', fontWeight: 600, marginTop: 2 }}>
                        {hwFreeRamGB} GB Free &amp; Available
                      </div>
                    </div>

                    <div style={{ padding: '10px 12px', background: '#FAF8F5', borderRadius: 8, border: '1px solid #EAE5DE' }}>
                      <div style={{ fontSize: 11, color: '#6B635B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Disk Storage</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1614', marginTop: 4 }}>
                        {hwStorageFree ?? '—'} Free
                      </div>
                      <div style={{ fontSize: 11, color: '#6B635B', marginTop: 2 }}>
                        {hwStorageTotal ? `${hwStorageTotal} Total Drive` : 'Local Storage'}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>
                      Tailored Model Recommendation
                    </div>
                    <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
                      {hwRecommendation.desc}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="settings-btn settings-btn-primary"
                      onClick={handleNavigateExplorer}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>Explore Compatible Models</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Downloads */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div className="settings-modal-group-title">
                  Active Model Downloads {activeDlCount > 0 ? `(${activeDlCount})` : ''}
                </div>
                <div className="settings-modal-card">
                  {activeDlCount === 0 ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748B', fontSize: 13 }}>
                      <Download size={24} style={{ margin: '0 auto 8px', color: '#94A3B8', display: 'block' }} />
                      No downloads currently active. Models downloaded from the Explorer will appear here with live progress and transfer speed.
                    </div>
                  ) : (
                    activeDlList.map((dl) => {
                      const pct = dl.totalBytes ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : 0
                      const speedMBps = dl.speedBps ? (dl.speedBps / (1024 * 1024)).toFixed(1) : null
                      const receivedMB = (dl.receivedBytes / (1024 * 1024)).toFixed(1)
                      const totalMB = dl.totalBytes ? (dl.totalBytes / (1024 * 1024)).toFixed(1) : '?'
                      return (
                        <div key={`${dl.modelId}-${dl.rfilename}`} style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{dl.rfilename}</div>
                              <div style={{ fontSize: 11, color: '#64748B' }}>{dl.modelId}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#C65D3B' }}>{pct}%</span>
                              <button
                                type="button"
                                className="settings-btn settings-btn-danger"
                                style={{ padding: '3px 8px', fontSize: 11 }}
                                onClick={() => handleCancelDownload(dl.modelId, dl.rfilename)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                          <div style={{ height: 6, width: '100%', background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: '#C65D3B', transition: 'width 0.2s ease' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#64748B' }}>
                            <span>{receivedMB} MB / {totalMB} MB {speedMBps ? `· ${speedMBps} MB/s` : ''}</span>
                            <span>{dl.etaSeconds ? `${Math.ceil(dl.etaSeconds)}s remaining` : 'Calculating ETA…'}</span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* External Runtimes & Local Model Discovery */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div className="settings-modal-group-title">External Model Runtimes</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Bot size={15} />
                        <span>Ollama Runtime</span>
                      </div>
                      <div className="settings-modal-row-desc">
                        Local daemon endpoint at <code>http://127.0.0.1:11434</code>
                      </div>
                    </div>
                    <span className="settings-info-chip" style={{ color: ollamaOnline ? '#059669' : '#64748B', fontWeight: 600 }}>
                      {ollamaOnline ? `Online (${runtimeSummary?.ollama?.manifestCount ?? 0} models)` : 'Not running'}
                    </span>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Cpu size={15} />
                        <span>LM Studio Runtime</span>
                      </div>
                      <div className="settings-modal-row-desc">
                        Local daemon endpoint at <code>http://127.0.0.1:1234</code>
                      </div>
                    </div>
                    <span className="settings-info-chip" style={{ color: lmOnline ? '#059669' : '#64748B', fontWeight: 600 }}>
                      {lmOnline ? `Online (${runtimeSummary?.lmstudio?.manifestCount ?? 0} models)` : 'Not running'}
                    </span>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Total Indexed Local Models</div>
                      <div className="settings-modal-row-desc">
                        Models ready for immediate local execution across external runtimes and internal storage.
                      </div>
                    </div>
                    <span className="settings-info-chip" style={{ fontWeight: 700 }}>
                      {totalLocalModels} models
                    </span>
                  </div>
                </div>
              </div>

              {/* Notification Preferences */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div className="settings-modal-group-title">Notification Preferences</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Session Completion Notifications</div>
                      <div className="settings-modal-row-desc">
                        Show an OS notification when an agent finishes generation while Sovara is minimized or in the background.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`settings-toggle ${appSettings?.sessionNotifications ?? true ? 'settings-toggle--on' : ''}`}
                      onClick={() => void applyPatch({ sessionNotifications: !(appSettings?.sessionNotifications ?? true) })}
                      role="switch"
                      aria-checked={appSettings?.sessionNotifications ?? true}
                    >
                      <span className="settings-toggle-thumb" />
                    </button>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Hardware &amp; Download Notifications</div>
                      <div className="settings-modal-row-desc">
                        Show an alert banner or system notification when a model finishes downloading in the background.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="settings-toggle settings-toggle--on"
                      role="switch"
                      aria-checked={true}
                      disabled
                      title="Always enabled for system integrity"
                    >
                      <span className="settings-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* AGENT TAB */}
          {activeTab === 'agent' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Agent Configuration</h1>
                <p className="settings-modal-subtitle">
                  Configure default root models, system prompt instructions, reasoning depth, and automation runtime.
                </p>
              </div>

              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Model &amp; Instructions</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Default Agent Model</div>
                      <div className="settings-modal-row-desc">
                        Model assigned to orchestrate tasks and run tools in new conversations.
                      </div>
                    </div>
                    <select
                      className="settings-select-pill"
                      value={appSettings?.rootModel ?? 'auto'}
                      onChange={(e) => void applyPatch({ rootModel: e.target.value })}
                    >
                      <option value="auto">Auto-detect best fit</option>
                      {agentModels.map((m) => (
                        <option key={m.modelId} value={m.modelId}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Deep Reasoning Tokens</div>
                      <div className="settings-modal-row-desc">
                        Enable internal chain-of-thought and structured planning before streaming answers.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`settings-toggle ${reasoningEnabled ? 'settings-toggle--on' : ''}`}
                      onClick={() => {
                        setReasoningEnabled((v) => {
                          const next = !v
                          void applyPatch({ reasoningEnabled: next })
                          return next
                        })
                      }}
                      role="switch"
                      aria-checked={reasoningEnabled}
                    >
                      <span className="settings-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Custom Instructions */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Custom Instructions (System Prompt)</div>
                <div className="settings-modal-card" style={{ padding: '14px 18px' }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                    Instructions injected into every agent session (preferred language, coding conventions, tone).
                  </div>
                  <textarea
                    className="settings-textarea"
                    rows={4}
                    value={instructionsDraft}
                    placeholder="e.g. Prefer concise explanations, write idiomatic TypeScript with strict types, and avoid unnecessary preamble."
                    onChange={(e) => {
                      setInstructionsDraft(e.target.value)
                      void applyPatch({ customInstructions: e.target.value })
                    }}
                  />
                </div>
              </div>

              {/* Automation Engine & Tools */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Automation Runtime &amp; Tools</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Live Web Search Tool</div>
                      <div className="settings-modal-row-desc">
                        {searchTestResult ?? 'Test the integrated TypeScript-only web search capability.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="settings-btn-action"
                      onClick={() => void runSearchTest()}
                      disabled={testingSearch}
                    >
                      {testingSearch ? 'Searching…' : 'Run Test Search'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* USAGE / BILLING TAB */}
          {activeTab === 'billing' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Token Usage &amp; Metrics</h1>
                <p className="settings-modal-subtitle">
                  Cumulative sovereign token accounting stored locally in SQLite. No third-party tracking.
                </p>
              </div>

              {/* Stat Cards */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Cumulative Accounting</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  <div className="usage-stat" style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <div className="usage-stat-label" style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>Total Tokens</div>
                    <div className="usage-stat-value" style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>
                      {totalUsage.totalTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="usage-stat" style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <div className="usage-stat-label" style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>Prompt Tokens</div>
                    <div className="usage-stat-value" style={{ fontSize: 24, fontWeight: 700, color: '#0284c7', marginTop: 4 }}>
                      {totalUsage.promptTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="usage-stat" style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <div className="usage-stat-label" style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>Completion Tokens</div>
                    <div className="usage-stat-value" style={{ fontSize: 24, fontWeight: 700, color: '#10b981', marginTop: 4 }}>
                      {totalUsage.completionTokens.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* By Model Table */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div className="settings-modal-group-title">Usage by Model</div>
                <div className="settings-modal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {modelUsage.length > 0 ? (
                    <table className="settings-table" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', background: 'var(--bg-soft)' }}>
                          <th style={{ padding: '10px 14px', color: '#475569' }}>Model Name</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', color: '#475569' }}>Prompt</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', color: '#475569' }}>Completion</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', color: '#475569' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modelUsage.map((m) => (
                          <tr key={m.model} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>{m.model}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#64748b' }}>{m.promptTokens.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#64748b' }}>{m.completionTokens.toLocaleString()}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{m.totalTokens.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                      No token usage recorded yet. Start a chat session to track local metrics.
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Activity Table */}
              {recentUsage.length > 0 ? (
                <div className="settings-modal-group" style={{ marginTop: 20 }}>
                  <div className="settings-modal-group-title">Recent Activity Log</div>
                  <div className="settings-modal-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="settings-table" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', background: 'var(--bg-soft)' }}>
                          <th style={{ padding: '8px 12px', color: '#475569' }}>Time</th>
                          <th style={{ padding: '8px 12px', color: '#475569' }}>Model</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>Prompt</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>Completion</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentUsage.slice(0, 10).map((r, i) => (
                          <tr key={`${r.timestamp}-${i}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(r.timestamp).toLocaleTimeString()}</td>
                            <td style={{ padding: '8px 12px', color: '#0f172a', fontWeight: 500 }}>{r.model}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>{r.promptTokens.toLocaleString()}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>{r.completionTokens.toLocaleString()}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{r.totalTokens.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* PREFERENCES TAB */}
          {activeTab === 'appearance' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Preferences</h1>
                <p className="settings-modal-subtitle">
                  Adjust sidebar material and code difference layouts. Sovara uses one light visual system.
                </p>
              </div>

              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Sidebar Material &amp; Layout</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Sidebar Material</div>
                      <div className="settings-modal-row-desc">
                        Choose between clean solid panels and soft translucent glass.
                      </div>
                    </div>
                    <select
                      className="settings-select-pill"
                      value={appSettings?.sidebarBackground ?? 'solid'}
                      onChange={(e) => void applyPatch({ sidebarBackground: e.target.value })}
                    >
                      <option value="solid">Solid (Clean)</option>
                      <option value="translucent">Translucent</option>
                    </select>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Inline Diff Layout</div>
                      <div className="settings-modal-row-desc">
                        Presentation of code modifications in tool approvals and artifacts.
                      </div>
                    </div>
                    <select
                      className="settings-select-pill"
                      value={appSettings?.inlineDiffLayout ?? 'unified'}
                      onChange={(e) => void applyPatch({ inlineDiffLayout: e.target.value })}
                    >
                      <option value="unified">Unified Diff</option>
                      <option value="split">Split (Side by side)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* SESSIONS TAB: FULL ACTIVE & ARCHIVED CHAT MANAGEMENT */}
          {activeTab === 'sessions' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Conversations &amp; Sessions</h1>
                <p className="settings-modal-subtitle">
                  Inspect, open, archive, or permanently delete conversation threads across all workspaces.
                </p>
              </div>

              {/* Fork Behavior */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Session Forking</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Rename Session After Fork</div>
                      <div className="settings-modal-row-desc">
                        Prompt to rename newly created sessions when branching conversation history.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`settings-toggle ${appSettings?.renameAfterFork ?? true ? 'settings-toggle--on' : ''}`}
                      onClick={() => void applyPatch({ renameAfterFork: !(appSettings?.renameAfterFork ?? true) })}
                      role="switch"
                      aria-checked={appSettings?.renameAfterFork ?? true}
                    >
                      <span className="settings-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Conversations */}
              <div className="settings-modal-group" style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div className="settings-modal-group-title" style={{ margin: 0 }}>
                    Active Conversations ({activeSessions.length})
                  </div>
                  <button
                    type="button"
                    className="settings-btn-action"
                    onClick={refreshSessionsData}
                    title="Refresh conversation list"
                  >
                    <RefreshCw size={12} />
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="settings-modal-card">
                  {activeSessions.length > 0 ? (
                    activeSessions.map((s) => {
                      const proj = projects.find((p) => p.id === s.projectId)
                      return (
                        <div key={s.id} className="settings-modal-row">
                          <div className="settings-modal-row-info">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="settings-modal-row-label">{s.title || 'Untitled Session'}</span>
                              <span className="settings-info-badge">
                                {proj ? proj.name : 'Standalone'}
                              </span>
                            </div>
                            <div className="settings-modal-row-desc">
                              Active • Last updated {new Date(s.updatedAt).toLocaleString()}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                              type="button"
                              className="settings-btn-action"
                              style={{ padding: '4px 10px', fontSize: 11, background: '#eff6ff', color: '#0284c7', borderColor: '#bfdbfe' }}
                              onClick={() => handleOpenChat(s.id)}
                            >
                              Open Chat
                            </button>
                            <button
                              type="button"
                              className="settings-btn-action"
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              onClick={() => void handleArchiveChat(s.id)}
                              title="Archive conversation"
                            >
                              Archive
                            </button>
                            {deletingSessionId === s.id ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  type="button"
                                  className="settings-btn-action"
                                  style={{ padding: '4px 8px', fontSize: 10, background: '#ef4444', color: '#fff', borderColor: '#ef4444' }}
                                  onClick={() => void handleDeleteChat(s.id)}
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  className="settings-btn-action"
                                  style={{ padding: '4px 8px', fontSize: 10 }}
                                  onClick={() => setDeletingSessionId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="settings-btn-action"
                                style={{ padding: '4px 8px', color: '#ef4444' }}
                                onClick={() => setDeletingSessionId(s.id)}
                                title="Delete conversation permanently"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                      No active conversations found.
                    </div>
                  )}
                </div>
              </div>

              {/* Archived Conversations */}
              <div className="settings-modal-group" style={{ marginTop: 24 }}>
                <div className="settings-modal-group-title">
                  Archived Conversations ({archivedSessions.length})
                </div>
                <div className="settings-modal-card">
                  {archivedSessions.length > 0 ? (
                    archivedSessions.map((s) => (
                      <div key={s.id} className="settings-modal-row">
                        <div className="settings-modal-row-info">
                          <div className="settings-modal-row-label">{s.title || 'Untitled Session'}</div>
                          <div className="settings-modal-row-desc">
                            Archived on {new Date(s.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            className="settings-btn-action"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => void handleUnarchiveChat(s.id)}
                          >
                            <RotateCcw size={12} />
                            <span>Restore</span>
                          </button>
                          <button
                            type="button"
                            className="settings-btn-action"
                            style={{ padding: '4px 8px', color: '#ef4444' }}
                            onClick={() => void handleDeleteChat(s.id)}
                            title="Delete permanently"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                      No archived conversations found.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* CONNECTED APPS / MCP TAB */}
          {activeTab === 'connected-apps' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h1 className="settings-modal-title">Connected Apps &amp; MCP</h1>
                    <p className="settings-modal-subtitle">
                      Model Context Protocol (MCP) integrations exposed to the agent as real toolports.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="settings-btn-action"
                    onClick={() => openAddMcpDialog(null)}
                  >
                    <Plus size={13} />
                    <span>Add Server</span>
                  </button>
                </div>
              </div>

              {/* Live servers — backend-driven (listMcpServers), no static presets */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Available Servers (live)</div>
                {mcpServers.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 10, background: 'var(--bg-soft)' }}>
                    No MCP servers configured yet. Add one with “Add Server” above.
                  </div>
                ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {mcpServers.slice(0, 6).map((srv) => (
                    <div
                      key={srv.id}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        background: 'var(--bg-soft)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{srv.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {srv.transport === 'stdio' ? srv.command : srv.endpoint}
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <span
                            className="settings-info-badge"
                            style={{
                              background: srv.status === 'connected' ? '#ecfdf5' : '#f1f5f9',
                              color: srv.status === 'connected' ? '#059669' : '#64748b',
                            }}
                          >
                            {srv.status ?? (srv.enabled ? 'configured' : 'disabled')}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="settings-btn-action"
                        style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11 }}
                        onClick={() => void handleProbeMcp(srv.id)}
                      >
                        Probe Status
                      </button>
                    </div>
                  ))}
                </div>
                )}
              </div>

              {/* Installed MCP Servers */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div className="settings-modal-group-title">Configured MCP Servers ({mcpServers.length})</div>
                <div className="settings-modal-card">
                  {mcpServers.length > 0 ? (
                    mcpServers.map((srv) => (
                      <div key={srv.id} className="settings-modal-row">
                        <div className="settings-modal-row-info">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="settings-modal-row-label">{srv.name}</span>
                            <span
                              className="settings-info-badge"
                              style={{
                                background: srv.status === 'connected' ? '#ecfdf5' : '#f1f5f9',
                                color: srv.status === 'connected' ? '#059669' : '#64748b',
                              }}
                            >
                              {srv.status ?? 'idle'}
                            </span>
                          </div>
                          <div className="settings-modal-row-desc">
                            {srv.transport === 'stdio' ? srv.command : srv.endpoint}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            className="settings-btn-action"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => void handleProbeMcp(srv.id)}
                            title="Probe server status"
                          >
                            Probe
                          </button>
                          <button
                            type="button"
                            className="settings-btn-action"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() => void handleToggleMcp(srv.id, !srv.enabled)}
                          >
                            {srv.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="settings-btn-action"
                            style={{ padding: '4px 8px', color: '#ef4444' }}
                            onClick={() => void handleRemoveMcp(srv.id)}
                            title="Remove server"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                      No external MCP servers configured. Add one or pick a preset above.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* SKILLS TAB */}
          {activeTab === 'skills' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h1 className="settings-modal-title">Skills &amp; Capabilities</h1>
                    <p className="settings-modal-subtitle">
                      Modular agent skills defined via standard <code>SKILL.md</code> instructions.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="settings-btn-action"
                      onClick={() => void handleScanSkills()}
                    >
                      <RefreshCw size={12} />
                      <span>Scan Skills</span>
                    </button>
                    <button
                      type="button"
                      className="settings-btn-action"
                      onClick={() => setSkillDialogOpen(true)}
                    >
                      <Plus size={12} />
                      <span>Add Skill</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Installed Bionic Skills */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Installed Bionic Skills ({bionicSkills.length})</div>
                <div className="settings-modal-card">
                  {bionicSkills.length > 0 ? (
                    bionicSkills.map((sk) => (
                      <div key={sk.name} className="settings-modal-row">
                        <div className="settings-modal-row-info">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="settings-modal-row-label">{sk.name}</span>
                            <span className="settings-info-badge">SKILL.md</span>
                          </div>
                          <div className="settings-modal-row-desc">{sk.description || 'Custom sovereign agent skill.'}</div>
                        </div>
                        <button
                          type="button"
                          className="settings-btn-action"
                          style={{ padding: '4px 8px', color: '#ef4444' }}
                          onClick={() => void handleRemoveSkill(sk.name)}
                          title="Delete skill"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                      No custom bionic skills installed yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Skill Sources */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div className="settings-modal-group-title">Skill Directory Sources ({skillsSources.length})</div>
                <div className="settings-modal-card">
                  {skillsSources.map((src) => (
                    <div key={src.name} className="settings-modal-row">
                      <div className="settings-modal-row-info">
                        <div className="settings-modal-row-label">{src.name}</div>
                        <div className="settings-modal-row-desc" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {src.path} • {src.skillCount} skill{src.skillCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`settings-toggle ${src.enabled ? 'settings-toggle--on' : ''}`}
                        onClick={() => void handleToggleSkillSource(src.name, !src.enabled)}
                        role="switch"
                        aria-checked={src.enabled}
                      >
                        <span className="settings-toggle-thumb" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Import from URL */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div className="settings-modal-group-title">Import Skill from URL</div>
                <div className="settings-modal-card" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="settings-input"
                      type="url"
                      placeholder="https://raw.githubusercontent.com/.../SKILL.md"
                      value={skillImportUrl}
                      onChange={(e) => setSkillImportUrl(e.target.value)}
                    />
                    <button
                      type="button"
                      className="settings-btn-action"
                      onClick={() => void handleSkillUrlImport()}
                      disabled={skillImporting || !skillImportUrl.trim()}
                    >
                      {skillImporting ? 'Importing…' : 'Import'}
                    </button>
                  </div>
                  {skillError ? (
                    <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{skillError}</div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* EXPLORE TAB */}
          {activeTab === 'explore' ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <ExplorePage
                onBack={() => setActiveTab('notifications')}
                onOpenSettings={(sec) => setActiveTab((sec as SettingsTabId) || 'notifications')}
              />
            </div>
          ) : null}

          {/* LIBRARY TAB */}
          {activeTab === 'library' ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <LibraryPage onBack={() => setActiveTab('general')} />
            </div>
          ) : null}

          {/* LOADED INSTANCES TAB */}
          {activeTab === 'loaded-instances' ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <LoadedInstancesSection onBack={() => setActiveTab('general')} />
            </div>
          ) : null}

          {/* LOCAL MODEL API TAB */}
          {activeTab === 'local-model-api' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Local Model API</h1>
                <p className="settings-modal-subtitle">
                  OpenAI-compatible local server. Every chat action is logged locally with zero cloud dependencies.
                </p>
              </div>

              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Endpoints &amp; Integration</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Base URL</div>
                      <div className="settings-modal-row-desc">OpenAI-compatible REST server</div>
                    </div>
                    <span className="settings-info-chip">http://127.0.0.1:11434/v1</span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Chat Completions</div>
                      <div className="settings-modal-row-desc">Standard streaming chat endpoint</div>
                    </div>
                    <span className="settings-info-chip">POST /v1/chat/completions</span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Models List</div>
                      <div className="settings-modal-row-desc">Inspect discovered local GGUF models</div>
                    </div>
                    <span className="settings-info-chip">GET /v1/models</span>
                  </div>
                </div>
              </div>

              {/* Logs */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div className="settings-modal-group-title" style={{ margin: 0 }}>Terminal Logs (chat.log &amp; runtime.log)</div>
                  <button
                    type="button"
                    className="settings-btn-action"
                    onClick={() => void handleRefreshLogs()}
                  >
                    <RefreshCw size={12} />
                    <span>Refresh Logs</span>
                  </button>
                </div>
                <div className="settings-modal-card" style={{ padding: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6, textTransform: 'uppercase' }}>
                        chat.log (last 10 lines)
                      </div>
                      <pre
                        style={{
                          fontSize: 11,
                          fontFamily: 'monospace',
                          background: 'var(--bg-soft)',
                          color: '#0f172a',
                          padding: 10,
                          borderRadius: 8,
                          maxHeight: 180,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        {(apiRecentLogs.chat ?? []).length > 0
                          ? (apiRecentLogs.chat ?? []).slice(-10).join('\n')
                          : 'No chat entries yet — send a message to see [SOVARA][CHAT] lines.'}
                      </pre>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6, textTransform: 'uppercase' }}>
                        runtime.log (last 10 lines)
                      </div>
                      <pre
                        style={{
                          fontSize: 11,
                          fontFamily: 'monospace',
                          background: 'var(--bg-soft)',
                          color: '#0f172a',
                          padding: 10,
                          borderRadius: 8,
                          maxHeight: 180,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        {(apiRecentLogs.runtime ?? []).length > 0
                          ? (apiRecentLogs.runtime ?? []).slice(-10).join('\n')
                          : 'No runtime entries yet.'}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* LOCAL MODEL DEFAULTS TAB */}
          {activeTab === 'local-model-defaults' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Local Model Defaults</h1>
                <p className="settings-modal-subtitle">
                  Hardware execution defaults for llama.cpp server instances and GGUF quantization runners.
                </p>
              </div>

              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Inference Engine Parameters</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Default Context Window</div>
                      <div className="settings-modal-row-desc">
                        Maximum token context allocated when spawning local llama.cpp runners.
                      </div>
                    </div>
                    <select
                      className="settings-select-pill"
                      value={contextLength}
                      onChange={(e) => {
                        const val = Number(e.target.value)
                        setContextLength(val)
                        void applyPatch({ contextLength: val })
                      }}
                    >
                      <option value={4096}>4,096 tokens</option>
                      <option value={8192}>8,192 tokens</option>
                      <option value={16384}>16,384 tokens</option>
                      <option value={32768}>32,768 tokens</option>
                    </select>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">GPU Offload Layers (n_gpu_layers)</div>
                      <div className="settings-modal-row-desc">
                        Layers offloaded to GPU VRAM (99 for full GPU offload, 0 for CPU only).
                      </div>
                    </div>
                    <select
                      className="settings-select-pill"
                      value={gpuLayers}
                      onChange={(e) => {
                        const val = Number(e.target.value)
                        setGpuLayers(val)
                        void applyPatch({ gpuLayers: val })
                      }}
                    >
                      <option value={99}>Full Offload (All Layers)</option>
                      <option value={33}>Partial Offload (33 Layers)</option>
                      <option value={0}>CPU Only (0 Layers)</option>
                    </select>
                  </div>

                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Flash Attention</div>
                      <div className="settings-modal-row-desc">
                        Accelerate prompt processing and reduce VRAM utilization.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`settings-toggle ${flashAttention ? 'settings-toggle--on' : ''}`}
                      onClick={() => {
                        setFlashAttention((v) => {
                          const next = !v
                          void applyPatch({ flashAttention: next })
                          return next
                        })
                      }}
                      role="switch"
                      aria-checked={flashAttention}
                    >
                      <span className="settings-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* RUNTIME & SYSTEM TAB */}
          {activeTab === 'runtime' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Runtime &amp; System Specs</h1>
                <p className="settings-modal-subtitle">
                  Host machine hardware profile, Electron environment, and sovereign data paths.
                </p>
              </div>

              {/* Host Machine */}
              <div className="settings-modal-group">
                <div className="settings-modal-group-title">Host Machine Specs</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">CPU Cores</div>
                    </div>
                    <span className="settings-info-chip">{systemInfo?.cpus ?? 8} logical cores</span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Total System RAM</div>
                    </div>
                    <span className="settings-info-chip">
                      {systemInfo ? `${(systemInfo.totalMemMB / 1024).toFixed(1)} GB` : '—'}
                    </span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Free System RAM</div>
                    </div>
                    <span className="settings-info-chip">
                      {systemInfo ? `${(systemInfo.freeMemMB / 1024).toFixed(1)} GB` : '—'}
                    </span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Home Directory</div>
                    </div>
                    <span className="settings-info-chip" style={{ wordBreak: 'break-all' }}>
                      {systemInfo?.homedir ?? '—'}
                    </span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">User Data Directory</div>
                    </div>
                    <span className="settings-info-chip" style={{ wordBreak: 'break-all' }}>
                      {systemInfo?.userData ?? '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sovara Environment */}
              <div className="settings-modal-group" style={{ marginTop: 20 }}>
                <div className="settings-modal-group-title">Application Environment</div>
                <div className="settings-modal-card">
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Application Version</div>
                    </div>
                    <span className="settings-info-chip">{appInfo?.version ?? '1.1.1'}</span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Electron Version</div>
                    </div>
                    <span className="settings-info-chip">{appInfo?.electron ?? '34.0.0'}</span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Node.js Version</div>
                    </div>
                    <span className="settings-info-chip">{appInfo?.node ?? '20.18.0'}</span>
                  </div>
                  <div className="settings-modal-row">
                    <div className="settings-modal-row-info">
                      <div className="settings-modal-row-label">Platform &amp; Architecture</div>
                    </div>
                    <span className="settings-info-chip">
                      {appInfo?.platform ?? process.platform} ({appInfo?.arch ?? process.arch})
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* PROJECT WORKSPACE TAB: COMPLETE WORKSPACE, CHATS, PERMISSIONS, SKILLS & DELETE */}
          {activeTab.startsWith('project:') ? (
            <div className="settings-modal-scroll">
              {(() => {
                const pid = activeTab.replace('project:', '')
                const project = projects.find((p) => p.id === pid)
                if (!project) {
                  return (
                    <div className="settings-modal-card settings-card--empty">
                      <span style={{ color: '#64748b' }}>Workspace not found or already deleted.</span>
                    </div>
                  )
                }
                const projectSessions = activeSessions.filter((s) => s.projectId === pid)

                return (
                  <>
                    <div className="settings-modal-header">
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <h1 className="settings-modal-title">{project.name}</h1>
                          <p className="settings-modal-subtitle">
                            Workspace folder configuration, active chat sessions, accessible skills, and workspace deletion.
                          </p>
                        </div>
                        {confirmDeleteProjectId === project.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                              type="button"
                              className="settings-btn-action"
                              style={{ background: '#ef4444', color: '#ffffff', borderColor: '#ef4444', fontWeight: 600 }}
                              onClick={() => void handleDeleteProject(project.id)}
                            >
                              Confirm Delete Project
                            </button>
                            <button
                              type="button"
                              className="settings-btn-action"
                              onClick={() => setConfirmDeleteProjectId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="settings-btn-action"
                            style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                            onClick={() => setConfirmDeleteProjectId(project.id)}
                          >
                            <Trash2 size={13} />
                            <span>Delete Project</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Workspace Directory */}
                    <div className="settings-modal-group">
                      <div className="settings-modal-group-title">Workspace Directory</div>
                      <div className="settings-modal-card">
                        <div className="settings-modal-row">
                          <div className="settings-modal-row-info">
                            <div className="settings-modal-row-label">Root Path</div>
                            <div className="settings-modal-row-desc" style={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>
                              {project.rootPath || 'd:/SOVARA'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="settings-btn-action"
                            onClick={() => {
                              void copyToClipboard(project.rootPath || 'd:/SOVARA')
                              setCopiedPath(true)
                              setTimeout(() => setCopiedPath(false), 2000)
                            }}
                          >
                            <Copy size={12} />
                            <span>{copiedPath ? 'Copied!' : 'Copy Path'}</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Workspace Permissions & Execution */}
                    <div className="settings-modal-group" style={{ marginTop: 20 }}>
                      <div className="settings-modal-group-title">Workspace Permissions &amp; Security</div>
                      <div className="settings-modal-card">
                        <div className="settings-modal-row">
                          <div className="settings-modal-row-info">
                            <div className="settings-modal-row-label">Execution Mode for this Workspace</div>
                            <div className="settings-modal-row-desc">
                              Controls whether tools run automatically in this workspace directory.
                            </div>
                          </div>
                          <select
                            className="settings-select-pill"
                            value={securityPreset}
                            onChange={(e) => {
                              const val = e.target.value
                              setSecurityPreset(val)
                              if (val === 'permissive') handleExecModeChange('allow')
                              else if (val === 'strict') handleExecModeChange('review')
                              else handleExecModeChange('ask')
                            }}
                          >
                            <option value="default">Default (Ask Each Time)</option>
                            <option value="permissive">Permissive (Auto-Run)</option>
                            <option value="strict">Strict (Review All)</option>
                          </select>
                        </div>

                        <div className="settings-modal-row">
                          <div className="settings-modal-row-info">
                            <div className="settings-modal-row-label">Available Tools in Workspace</div>
                            <div className="settings-modal-row-desc">
                              Filesystem tools, terminal shell, MCP servers, and web reading are enabled for this workspace.
                            </div>
                          </div>
                          <button
                            type="button"
                            className="settings-btn-action"
                            onClick={() => setToolPermissionsOpen(true)}
                          >
                            Inspect Tools ({totalToolsCount})
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Accessible Skills & Agents */}
                    <div className="settings-modal-group" style={{ marginTop: 20 }}>
                      <div className="settings-modal-group-title">Accessible Skills &amp; Agents</div>
                      <div className="settings-modal-card">
                        <div className="settings-modal-row">
                          <div className="settings-modal-row-info">
                            <div className="settings-modal-row-label">Bionic Skills Accessible</div>
                            <div className="settings-modal-row-desc">
                              {bionicSkills.length > 0
                                ? `${bionicSkills.length} Bionic skills available to chats in this workspace.`
                                : 'No custom skills installed.'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="settings-btn-action"
                            onClick={() => setActiveTab('skills')}
                          >
                            Manage Skills
                          </button>
                        </div>

                        <div className="settings-modal-row">
                          <div className="settings-modal-row-info">
                            <div className="settings-modal-row-label">Default Model for this Workspace</div>
                            <div className="settings-modal-row-desc">
                              Active model assigned to new conversations in this project.
                            </div>
                          </div>
                          <select
                            className="settings-select-pill"
                            value={appSettings?.rootModel ?? 'auto'}
                            onChange={(e) => void applyPatch({ rootModel: e.target.value })}
                          >
                            <option value="auto">Auto-detect best fit</option>
                            {agentModels.map((m) => (
                              <option key={m.modelId} value={m.modelId}>
                                {m.displayName}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Chats in this Project */}
                    <div className="settings-modal-group" style={{ marginTop: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div className="settings-modal-group-title" style={{ margin: 0 }}>
                          Conversations in this Workspace ({projectSessions.length})
                        </div>
                        <button
                          type="button"
                          className="settings-btn-action"
                          style={{ background: '#0284c7', color: '#ffffff', borderColor: '#0284c7' }}
                          onClick={() => void handleCreateProjectChat(project.id)}
                        >
                          <Plus size={12} />
                          <span>New Chat</span>
                        </button>
                      </div>
                      <div className="settings-modal-card">
                        {projectSessions.length > 0 ? (
                          projectSessions.map((s) => (
                            <div key={s.id} className="settings-modal-row">
                              <div className="settings-modal-row-info">
                                <div className="settings-modal-row-label">{s.title || 'Untitled Session'}</div>
                                <div className="settings-modal-row-desc">
                                  Last active {new Date(s.updatedAt).toLocaleString()}
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button
                                  type="button"
                                  className="settings-btn-action"
                                  style={{ padding: '4px 10px', fontSize: 11, background: '#eff6ff', color: '#0284c7', borderColor: '#bfdbfe' }}
                                  onClick={() => handleOpenChat(s.id)}
                                >
                                  Open Chat
                                </button>
                                <button
                                  type="button"
                                  className="settings-btn-action"
                                  style={{ padding: '4px 10px', fontSize: 11 }}
                                  onClick={() => void handleArchiveChat(s.id)}
                                  title="Archive conversation"
                                >
                                  Archive
                                </button>
                                {deletingSessionId === s.id ? (
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <button
                                      type="button"
                                      className="settings-btn-action"
                                      style={{ padding: '4px 8px', fontSize: 10, background: '#ef4444', color: '#fff', borderColor: '#ef4444' }}
                                      onClick={() => void handleDeleteChat(s.id)}
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      className="settings-btn-action"
                                      style={{ padding: '4px 8px', fontSize: 10 }}
                                      onClick={() => setDeletingSessionId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="settings-btn-action"
                                    style={{ padding: '4px 8px', color: '#ef4444' }}
                                    onClick={() => setDeletingSessionId(s.id)}
                                    title="Delete conversation permanently"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                            No active conversations in this project yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          ) : null}

          {/* SHORTCUTS TAB */}
          {activeTab === 'shortcuts' ? (
            <div className="settings-modal-scroll">
              <div className="settings-modal-header">
                <h1 className="settings-modal-title">Keyboard Shortcuts</h1>
                <p className="settings-modal-subtitle">
                  Keyboard shortcuts to accelerate navigation, chat generation, and workspace controls.
                </p>
              </div>

              <div className="settings-modal-card">
                {[
                  { keys: ['Ctrl', ','], desc: 'Toggle Settings Popup Modal' },
                  { keys: ['Ctrl', 'Enter'], desc: 'Send Chat Message' },
                  { keys: ['Ctrl', 'N'], desc: 'Start New Conversation' },
                  { keys: ['Ctrl', 'B'], desc: 'Toggle Sidebar Panel' },
                  { keys: ['Ctrl', 'K'], desc: 'Focus Model Selector' },
                  { keys: ['Esc'], desc: 'Close Dialog / Cancel Streaming' },
                ].map((s, idx) => (
                  <div key={idx} className="settings-modal-row">
                    <div className="settings-modal-row-label">{s.desc}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: 'var(--panel)',
                            border: '1px solid #e2e8f0',
                            fontSize: 11,
                            fontFamily: 'inherit',
                            fontWeight: 600,
                            color: '#0f172a',
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}


        </main>
      </div>

      {/* TOOL PERMISSIONS SUB-MODAL */}
      {toolPermissionsOpen ? (
        <div
          className="settings-modal-overlay"
          style={{ zIndex: 1100 }}
          onClick={() => setToolPermissionsOpen(false)}
        >
          <div
            className="settings-modal-window"
            style={{ width: 560, height: 600, flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Tool Permissions</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                  {totalToolsCount} registered tool capabilities in the sovereign runtime
                </p>
              </div>
              <button
                type="button"
                className="settings-modal-close-btn"
                style={{ position: 'static' }}
                onClick={() => setToolPermissionsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {agentTools.length > 0 ? (
                  agentTools.map((t) => (
                    <div
                      key={t.name}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        background: 'var(--bg-soft)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{t.name}</span>
                          <span className="settings-info-badge">{t.toolset}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{t.description}</div>
                      </div>
                      <span
                        className="settings-info-badge"
                        style={{
                          background: execMode === 'allow' ? '#ecfdf5' : '#eff6ff',
                          color: execMode === 'allow' ? '#059669' : '#0284c7',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {execMode === 'allow' ? 'Permitted' : execMode === 'review' ? 'Strict Review' : 'Ask User'}
                      </span>
                    </div>
                  ))
                ) : (
                  [
                    { name: 'File System (read/write/edit)', desc: 'Inspect and edit workspace files', toolset: 'fs' },
                    { name: 'Terminal Shell (run_command)', desc: 'Execute PowerShell terminal commands', toolset: 'shell' },
                    { name: 'Live Web Search (web_search)', desc: 'Query live web documentation', toolset: 'web' },
                    { name: 'Model Context Protocol (mcp_*)', desc: 'Call connected MCP server tools', toolset: 'mcp' },
                  ].map((t) => (
                    <div
                      key={t.name}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        background: 'var(--bg-soft)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{t.desc}</div>
                      </div>
                      <span
                        className="settings-info-badge"
                        style={{
                          background: execMode === 'allow' ? '#ecfdf5' : '#eff6ff',
                          color: execMode === 'allow' ? '#059669' : '#0284c7',
                        }}
                      >
                        {execMode === 'allow' ? 'Permitted' : 'Ask User'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-btn-action"
                style={{ background: '#0284c7', color: '#ffffff', borderColor: '#0284c7' }}
                onClick={() => setToolPermissionsOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* NETWORK ACCESS RULES SUB-MODAL */}
      {networkRulesOpen ? (
        <div
          className="settings-modal-overlay"
          style={{ zIndex: 1100 }}
          onClick={() => setNetworkRulesOpen(false)}
        >
          <div
            className="settings-modal-window"
            style={{ width: 520, height: 500, flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Network Access Rules</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                  Domains permitted for sovereign web reading and document scraping
                </p>
              </div>
              <button
                type="button"
                className="settings-modal-close-btn"
                style={{ position: 'static' }}
                onClick={() => setNetworkRulesOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input
                  className="settings-input"
                  placeholder="e.g. *.example.com"
                  value={newDomainInput}
                  onChange={(e) => setNewDomainInput(e.target.value)}
                />
                <button
                  type="button"
                  className="settings-btn-action"
                  onClick={() => {
                    const trimmed = newDomainInput.trim()
                    if (trimmed && !allowedDomains.includes(trimmed)) {
                      const next = [...allowedDomains, trimmed]
                      setAllowedDomains(next)
                      void applyPatch({ allowedDomains: next })
                      setNewDomainInput('')
                    }
                  }}
                >
                  Add
                </button>
              </div>
              <div className="settings-modal-card" style={{ padding: 0, overflow: 'hidden' }}>
                {allowedDomains.map((d) => (
                  <div key={d} className="settings-modal-row" style={{ padding: '8px 14px' }}>
                    <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#0f172a' }}>{d}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="settings-info-badge" style={{ color: '#059669', background: '#ecfdf5' }}>Allowed</span>
                      <button
                        type="button"
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
                        onClick={() => {
                          const next = allowedDomains.filter((item) => item !== d)
                          setAllowedDomains(next)
                          void applyPatch({ allowedDomains: next })
                        }}
                        title="Remove rule"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-btn-action"
                style={{ background: '#0284c7', color: '#ffffff', borderColor: '#0284c7' }}
                onClick={() => setNetworkRulesOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ADD MCP SERVER MODAL */}
      {mcpDialogOpen ? (
        <div
          className="settings-modal-overlay"
          style={{ zIndex: 1100 }}
          onClick={() => setMcpDialogOpen(false)}
        >
          <div
            className="settings-modal-window"
            style={{ width: 480, height: 440, flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                {mcpDialogPreset ? `Install ${mcpDialogPreset.name}` : 'Add MCP Server'}
              </h2>
              <button
                type="button"
                className="settings-modal-close-btn"
                style={{ position: 'static' }}
                onClick={() => setMcpDialogOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                  Server Name
                </label>
                <input
                  className="settings-input"
                  placeholder="e.g. Postgres MCP"
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                  Transport Protocol
                </label>
                <select
                  className="settings-select-pill"
                  value={mcpForm.transport}
                  onChange={(e) => setMcpForm((prev) => ({ ...prev, transport: e.target.value as 'stdio' | 'http' }))}
                >
                  <option value="stdio">stdio (Local Command)</option>
                  <option value="http">HTTP (SSE / REST)</option>
                </select>
              </div>
              {mcpForm.transport === 'stdio' ? (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                    Launch Command
                  </label>
                  <input
                    className="settings-input"
                    placeholder="e.g. npx -y @modelcontextprotocol/server-postgres postgresql://..."
                    value={mcpForm.command}
                    onChange={(e) => setMcpForm((prev) => ({ ...prev, command: e.target.value }))}
                  />
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                    HTTP Endpoint URL
                  </label>
                  <input
                    className="settings-input"
                    placeholder="http://localhost:3000/sse"
                    value={mcpForm.endpoint}
                    onChange={(e) => setMcpForm((prev) => ({ ...prev, endpoint: e.target.value }))}
                  />
                </div>
              )}
              {mcpError ? (
                <div style={{ color: '#ef4444', fontSize: 12 }}>{mcpError}</div>
              ) : null}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="settings-btn-action"
                onClick={() => setMcpDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="settings-btn-action"
                style={{ background: '#0284c7', color: '#ffffff', borderColor: '#0284c7' }}
                onClick={() => void handleAddMcp()}
                disabled={!mcpForm.name.trim() || (mcpForm.transport === 'stdio' ? !mcpForm.command.trim() : !mcpForm.endpoint.trim())}
              >
                Install Server
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ADD BIONIC SKILL MODAL */}
      {skillDialogOpen ? (
        <div
          className="settings-modal-overlay"
          style={{ zIndex: 1100 }}
          onClick={() => setSkillDialogOpen(false)}
        >
          <div
            className="settings-modal-window"
            style={{ width: 500, height: 480, flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Add Bionic Skill</h2>
              <button
                type="button"
                className="settings-modal-close-btn"
                style={{ position: 'static' }}
                onClick={() => setSkillDialogOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                  Skill Name
                </label>
                <input
                  className="settings-input"
                  placeholder="e.g. code-reviewer"
                  value={skillForm.name}
                  onChange={(e) => setSkillForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                  Description
                </label>
                <input
                  className="settings-input"
                  placeholder="e.g. Enforces rigorous code style and static checks"
                  value={skillForm.description}
                  onChange={(e) => setSkillForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                  Skill Instructions (Markdown)
                </label>
                <textarea
                  className="settings-textarea"
                  rows={5}
                  placeholder="# Instructions&#10;When reviewing PRs, verify test coverage..."
                  value={skillForm.content}
                  onChange={(e) => setSkillForm((prev) => ({ ...prev, content: e.target.value }))}
                />
              </div>
              {skillError ? (
                <div style={{ color: '#ef4444', fontSize: 12 }}>{skillError}</div>
              ) : null}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="settings-btn-action"
                onClick={() => setSkillDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="settings-btn-action"
                style={{ background: '#0284c7', color: '#ffffff', borderColor: '#0284c7' }}
                onClick={() => void handleAddSkill()}
                disabled={!skillForm.name.trim() || !skillForm.content.trim()}
              >
                Save Skill
              </button>
            </div>
          </div>
        </div>
      ) : null}

          {activeTab === 'knowledge-graph' ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              <div className="settings-modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                <h1 className="settings-modal-title">Knowledge Graph</h1>
                <p className="settings-modal-subtitle">Wiki folder • auto-mapped from chat context • 2D • drag to pan, scroll to zoom</p>
              </div>
              <div style={{ flex: 1, minHeight: 0, height: 560, borderTop: '1px solid #e2e8f0', position: 'relative', overflow: 'hidden', background: 'var(--bg-elevated)' }}>
                <KnowledgeGraph3D workspaceRoot={appSettings?.globalWorkspaceRoot ?? undefined} />
              </div>
            </div>
          ) : null}
    </div>
  )
}
