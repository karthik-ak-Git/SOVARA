import { z } from 'zod'

export const zSessionsCreate = z
  .object({ title: z.string().max(120).optional(), projectId: z.string().min(1).max(128).nullable().optional() })
  .strict()
  .default({})

export const zSessionId = z.string().min(1).max(128)

export const zSessionRename = z
  .object({ sessionId: zSessionId, title: z.string().min(1).max(120) })
  .strict()

export const zProjectCreate = z
  .object({ name: z.string().min(1).max(120), rootPath: z.string().min(1).max(1024) })
  .strict()

export const zProjectId = z
  .object({ projectId: z.string().min(1).max(128) })
  .strict()

export const zProjectRename = z
  .object({ projectId: z.string().min(1).max(128), name: z.string().min(1).max(120) })
  .strict()

export const zSessionArchive = z
  .object({ sessionId: zSessionId })
  .strict()

export const zChatSend = z
  .object({
    sessionId: z.string().min(1).max(128),
    content: z.string().min(1).max(32_000),
    webSearch: z.boolean().optional()
  })
  .strict()

export const zChatCancel = z
  .object({ sessionId: zSessionId })
  .strict()

export const zChatRegenerate = z
  .object({ sessionId: z.string().min(1).max(128) })
  .strict()

export const zChatEditResend = z
  .object({
    sessionId: z.string().min(1).max(128),
    content: z.string().min(1).max(32_000),
    webSearch: z.boolean().optional(),
  })
  .strict()

export const zModelsProbe = z.string().min(1).max(64)

const zRuntimeType = z.enum(['openai-compatible', 'ollama', 'lmstudio', 'vllm', 'llama.cpp', 'custom'])

const zRuntimeId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/, 'runtime id must be alphanumeric with . _ -')

export const zModelsAddRuntime = z
  .object({
    displayName: z.string().min(1).max(80),
    endpoint: z.string().min(1).max(256),
    type: zRuntimeType.optional(),
    timeoutMs: z.number().int().min(1000).max(30_000).optional(),
  })
  .strict()

export const zModelsRuntimeRef = z
  .object({ runtimeId: zRuntimeId })
  .strict()

export const zModelsListModels = z
  .object({ runtimeId: zRuntimeId.optional() })
  .strict()
  .default({})

export const zModelsSelect = z
  .object({ runtimeId: zRuntimeId, modelId: z.string().min(1).max(256) })
  .strict()

export const zModelsLoad = z
  .object({ modelId: z.string().min(1).max(128) })
  .strict()

export const zModelsRegistryList = z
  .object({ runtimeId: zRuntimeId.optional() })
  .strict()
  .default({})

export const zModelsRegistryUpdate = z
  .object({
    id: z.string().min(1).max(2048),
    patch: z
      .object({
        installStatus: z.enum(['installed', 'missing', 'unregistered']).optional(),
        runtimeId: z.string().min(1).max(64).nullable().optional(),
        displayName: z.string().min(1).max(120).optional(),
      })
      .strict(),
  })
  .strict()

export const zModelsRegistryRef = z
  .object({ id: z.string().min(1).max(2048) })
  .strict()

export const zModelsRegistryPath = z
  .object({ localPath: z.string().min(1).max(1024) })
  .strict()

export const zSkillsToggle = z
  .object({ sourceName: z.string().min(1).max(128), enabled: z.boolean() })
  .strict()

export const zBionicSkillAdd = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(200).optional(),
    content: z.string().min(1).max(8000),
  })
  .strict()

export const zBionicSkillId = z.object({ id: z.string().min(1).max(64) }).strict()

export const zSkillImportFromUrl = z.object({ url: z.string().min(8).max(2048).url() }).strict()

export const zExploreListModels = z
  .object({
    sortBy: z.string().optional(),
    query: z.string().optional(),
    pipelineTag: z.string().max(64).optional(),
    tag: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    /** Format filter the backend supports (HF file-list based). */
    format: z.enum(['all', 'gguf', 'safetensors', 'mixed', 'other']).optional(),
    /** GGUF quant tokens; a model matches when ANY runnable file carries one. */
    quants: z.array(z.string().min(1).max(16)).max(20).optional(),
    /** Parameter-count bucket (param count, never file size). */
    params: z.enum(['all', 'lt3', 'b3to7', 'b7to14', 'b14to32', 'b32to70', 'gt70']).optional(),
    /** License families derived from card metadata. */
    licenses: z.array(z.string().min(1).max(32)).max(8).optional(),
    /** UI capability names. */
    capabilities: z.array(z.string().min(1).max(32)).max(8).optional(),
    gated: z.enum(['all', 'accessible', 'gated']).optional(),
    downloaded: z.enum(['all', 'downloaded', 'available']).optional(),
    compat: z.enum(['all', 'likely', 'possible', 'unlikely', 'unknown']).optional(),
    /** Opaque HF cursor for the next page. */
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict()
  .default({})

export const zExploreGetModel = z
  .object({ modelId: z.string().min(1).max(128) })
  .strict()

export const zExploreGetCompatibility = z
  .object({ modelId: z.string().min(1).max(128) })
  .strict()

export const zExploreGetRecommendations = z
  .object({ modelId: z.string().min(1).max(128) })
  .strict()

export const zLibrarySetDirectory = z
  .object({ path: z.string().max(512).default('') })
  .strict()

const zDownloadPart = z
  .object({
    rfilename: z.string().min(1).max(512),
    downloadUrl: z.string().min(1).max(2048),
  })
  .strict()

export const zLibraryDownload = z
  .object({
    modelId: z.string().min(1).max(128),
    rfilename: z.string().min(1).max(512),
    downloadUrl: z.string().min(1).max(2048),
    /** Shard-set parts (multi-part model): downloaded sequentially as one job. */
    parts: z.array(zDownloadPart).min(2).max(8).optional(),
    /** Vision projector sidecar, fetched automatically with the weight. */
    companion: zDownloadPart.optional(),
    /** HF revision the bytes come from (Explorer pins 'main'). Part of the stable identity. */
    revision: z.string().min(1).max(128).optional(),
    format: z.string().max(32).optional(),
    quantization: z.string().max(32).optional(),
    license: z.string().max(128).optional(),
    gated: z.boolean().optional(),
  })
  .strict()

export const zLibraryCancel = z
  .object({
    modelId: z.string().min(1).max(128),
    rfilename: z.string().min(1).max(512),
  })
  .strict()

export const zLibraryDelete = z
  .object({ path: z.string().min(1).max(1024) })
  .strict()

export const zLibraryIsDownloaded = z
  .object({ modelId: z.string().min(1).max(128), rfilename: z.string().min(1).max(512), revision: z.string().min(1).max(128).optional() })
  .strict()

export const zLibraryFileRef = z
  .object({ modelId: z.string().min(1).max(128), rfilename: z.string().min(1).max(512), revision: z.string().min(1).max(128).optional() })
  .strict()

export const zShellOpenExternal = z
  .object({ url: z.string().min(1).max(2048) })
  .strict()

export const zSettingsSet = z
  .object({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    sidebarBackground: z.enum(['solid', 'translucent']).optional(),
    inlineDiffLayout: z.enum(['unified', 'split']).optional(),
    renameAfterFork: z.boolean().optional(),
    globalWorkspaceRoot: z.string().max(1024).optional(),
    allowModelDownload: z.boolean().optional(),
    autoUpdates: z.boolean().optional(),
    sessionNotifications: z.boolean().optional(),
    updateFeedUrl: z.string().max(2048).optional(),
    updateChannel: z.enum(['stable', 'beta']).optional(),
    rootModel: z.string().max(256).optional(),
    visionModel: z.string().max(256).optional(),
    webSearch: z.boolean().optional(),
    explorationAgents: z.boolean().optional(),
    customAutoReview: z.boolean().optional(),
    customInstructions: z.string().max(4000).optional(),
  })
  .strict()

export const zExecMode = z.enum(['off', 'ask', 'review', 'allow'])

export const zToolDispatch = z
  .object({ name: z.string().min(1).max(128), args: z.record(z.unknown()).default({}) })
  .strict()

export const zVoiceTranscribe = z
  .object({
    audio: z.string().min(1), // base64-encoded audio
    filename: z.string().min(1).max(256),
  })
  .strict()

export const zMcpAdd = z
  .object({
    name: z.string().min(1).max(80),
    provider: z.string().max(80).optional(),
    transport: z.enum(['stdio', 'http']),
    command: z.string().max(512).optional(),
    endpoint: z.string().max(512).optional(),
  })
  .strict()

export const zMcpInstallFromUrl = z
  .object({ url: z.string().min(8).max(2048).url() })
  .strict()

export const zMcpId = z.object({ id: z.string().min(1).max(64) }).strict()

export const zMcpToggle = z.object({ id: z.string().min(1).max(64), enabled: z.boolean() }).strict()

export const zValidationStart = z
  .object({ modelId: z.string().min(1).max(256), libraryPath: z.string().max(1024).optional(), ctxLen: z.number().int().min(256).max(131072).optional() })
  .strict()

export const zValidationGet = z.object({ jobId: z.string().min(1).max(64) }).strict()

export const zInstanceId = z.object({ instanceId: z.string().min(1).max(128) }).strict()
