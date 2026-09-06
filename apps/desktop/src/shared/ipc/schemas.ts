import { z } from 'zod'

export const zSessionsCreate = z
  .object({ title: z.string().max(120).optional() })
  .strict()
  .default({})

export const zSessionId = z.string().min(1).max(128)

export const zChatSend = z
  .object({
    sessionId: z.string().min(1).max(128),
    content: z.string().min(1).max(32_000)
  })
  .strict()

export const zModelsProbe = z.string().min(1).max(64)

export const zModelsLoad = z
  .object({ modelId: z.string().min(1).max(128) })
  .strict()

export const zSettingsSet = z.record(z.unknown())
