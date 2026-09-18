import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['node-llama-cpp'] })],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        onwarn(warning, warn) {
          // Suppress vite chunk warnings for files that are both static and dynamic imported (e.g., paths, HttpClient)
          // These are intentional for code-splitting and do not break dev — they just make the dev log noisy.
          if (typeof warning.message === 'string' && warning.message.includes('dynamically imported') && warning.message.includes('but also statically imported')) return
          if (typeof warning.message === 'string' && warning.message.includes('is dynamically imported by')) return
          warn(warning)
        },
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'src/preload/preload.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        },
        onwarn(warning, warn) {
          if (typeof warning.message === 'string' && warning.message.includes('dynamically imported')) return
          warn(warning)
        },
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        onwarn(warning, warn) {
          if (typeof warning.message === 'string' && warning.message.includes('dynamically imported')) return
          warn(warning)
        },
      }
    }
  }
})
