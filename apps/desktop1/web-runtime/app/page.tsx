import { App } from '@/App'

export const dynamic = 'force-dynamic'

/**
 * Home — renders the migrated Sovara workspace. `App` is a Client Component
 * (chat composer, streaming, model selection, and all interactivity live
 * there); this page stays a Server Component so the shell streams
 * immediately while client state hydrates.
 */
export default function HomePage() {
  return <App />
}
