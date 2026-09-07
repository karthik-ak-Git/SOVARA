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
    content: z.string().min(1).max(32_000)
  })
  .strict()

export const zChatCancel = z
  .object({ sessionId: zSessionId })
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

export const zSkillsToggle = z
  .object({ sourceName: z.string().min(1).max(128), enabled: z.boolean() })
  .strict()

export const zExploreListModels = z
  .object({ sortBy: z.string().optional(), query: z.string().optional() })
  .strict()
  .default({})

export const zExploreGetModel = z
  .object({ modelId: z.string().min(1).max(128) })
  .strict()

export const zExploreGetCompatibility = z
  .object({ modelId: z.string().min(1).max(128) })
  .strict()

export const zLibrarySetDirectory = z
  .object({ path: z.string().min(1).max(512) })
  .strict()

export const zSettingsSet = z
  .object({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    allowModelDownload: z.boolean().optional(),
    autoUpdates: z.boolean().optional(),
    sessionNotifications: z.boolean().optional(),
    updateFeedUrl: z.string().max(2048).optional(),
    updateChannel: z.enum(['stable', 'beta']).optional(),
    rootModel: z.string().max(256).optional(),
    visionModel: z.string().max(256).optional(),
    webSearch: z.boolean().optional(),
    webSearchApiKey: z.string().max(512).optional(),
    webSearchBaseUrl: z.string().max(512).optional(),
    webSearchModel: z.string().max(128).optional(),
    explorationAgents: z.boolean().optional(),
    customAutoReview: z.boolean().optional(),
    customInstructions: z.string().max(4000).optional(),
  })
  .strict()

export const zExecMode = z.enum(['off', 'ask', 'review', 'allow'])

export const zToolDispatch = z
  .object({ name: z.string().min(1).max(128), args: z.record(z.unknown()).default({}) })
  .strict()
