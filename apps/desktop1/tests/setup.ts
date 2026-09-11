import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { installEventSourceMock, resetStreams } from './helpers/sse'

// The migrated UI talks to the internal Next.js API over fetch + SSE.
// jsdom/node provide no EventSource — install the mock once per test file.
installEventSourceMock()

afterEach(() => {
  resetStreams()
})
