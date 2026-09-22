import type { ReactElement } from 'react'
import { SettingsModal } from '@/components/modals/SettingsModal'

export function SettingsPage({ onBack }: { onBack?: () => void }): ReactElement {
  return (
    <SettingsModal
      open={true}
      onClose={onBack ?? (() => {})}
    />
  )
}
