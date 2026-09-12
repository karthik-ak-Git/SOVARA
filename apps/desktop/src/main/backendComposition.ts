import { AppBackend } from './backend/AppBackend'

let backend: AppBackend | null = null

export function getBackend(): AppBackend {
  if (!backend) backend = new AppBackend()
  return backend
}

export async function disposeBackend(): Promise<void> {
  if (backend) {
    await backend.dispose()
    backend = null
  }
}
