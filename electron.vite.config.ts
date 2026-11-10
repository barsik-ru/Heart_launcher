import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'

function readBuildEnv(): Record<string, string> {
  const result: Record<string, string> = {}
  const envPath = resolve(__dirname, '.env')
  if (!existsSync(envPath)) return result
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, '')
    result[key] = value
  }
  return result
}

const buildEnv = { ...readBuildEnv(), ...process.env }

export default defineConfig({
  main: {
    define: {
      __VERDANT_API_BASE_URL__: JSON.stringify(buildEnv.VERDANT_API_BASE_URL ?? ''),
      __HEART_BRIDGE_API_BASE_URL__: JSON.stringify(buildEnv.HEART_BRIDGE_API_BASE_URL ?? '')
    },
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } } },
  renderer: { root: resolve(__dirname, 'src/renderer'), base: './', envDir: resolve(__dirname), resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src'), '@shared': resolve(__dirname, 'src/shared') } }, plugins: [react()], server: { port: 5173, strictPort: true } }
})
