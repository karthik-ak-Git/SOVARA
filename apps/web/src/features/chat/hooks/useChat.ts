/**
 * useChat — convenience hook wrapping the Zustand chatStore for component use.
 * Thin facade so components can import from hooks/ rather than stores/.
 */
export { useChatStore as useChat } from '../../../stores/chatStore'
