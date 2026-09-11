/**
 * messageProjection — re-exports and extends conversation derivation.
 * Keeps ChatStore and components independent of storage shape.
 * All rendering derives from SessionEventLike[] via deriveMessages().
 */
export { deriveMessages, isEmptyConversation, type ChatMessage, type SessionEventLike } from '../conversation'
