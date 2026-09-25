import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyThemePreference } from './theme/theme'
import './theme/global.css'

// Sovara is intentionally light-only. Set the contract before React mounts so
// native controls and the first renderer frame use the same palette.
applyThemePreference('light')

const el = document.getElementById('root')
if (!el) throw new Error('root not found')
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
