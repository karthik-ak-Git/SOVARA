import type { InputHTMLAttributes, ReactNode } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: ReactNode
}

export function Input({ label, hint, id, className = '', ...rest }: Props): React.JSX.Element {
  return (
    <div className="field">
      {label ? (
        <label htmlFor={id} className="field-label">
          {label}
        </label>
      ) : null}
      <input id={id} className={`input ${className}`.trim()} {...rest} />
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  )
}
