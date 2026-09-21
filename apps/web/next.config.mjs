import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The internal server layer reuses the proven Electron-main backend
  // (ports/adapters/services) as its single source of truth — no duplicate
  // implementations. `electron` is aliased to a minimal server-only shim
  // (app paths/version) because the backend only uses Electron for
  // getPath/getVersion/getAppPath/isReady, all of which have
  // SOVARA_DATA_DIR-backed fallbacks.
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@shared': path.resolve(__dirname, '../desktop/src/shared'),
      '@sovara-main': path.resolve(__dirname, '../desktop/src/main'),
      'zod/v3': 'zod',
      'zod/v4-mini': 'zod',
    }
    if (isServer) {
      config.resolve.alias['electron'] = path.resolve(
        __dirname,
        'src/lib/server/electron-shim.ts'
      )
      // Force Next.js to externalize these packages in API routes to prevent deep import resolution errors
      config.externals.push(
        '@modelcontextprotocol/sdk',
        'zod-to-json-schema',
        'zod'
      )
    }
    return config
  },
  // Server-only packages with native/Node built-ins must stay external.
  // (node:sqlite / child_process are externalized automatically.)
  experimental: {
    serverComponentsExternalPackages: ['@modelcontextprotocol/sdk', 'zod-to-json-schema', 'zod'],
  },
}

export default nextConfig
