import type { ReactElement } from 'react'

interface Props {
  label: string
}

/**
 * SessionBadge — Stitch centered session divider:
 * line + "TODAY • Project X" + line.
 */
export function SessionBadge({ label }: Props): ReactElement {
  return (
    <div className="stitch-session-badge-row" role="status" aria-label={label}>
      <span className="stitch-session-badge-line" aria-hidden />
      <span className="stitch-session-badge-text">{label}</span>
      <span className="stitch-session-badge-line" aria-hidden />
    </div>
  )
}
