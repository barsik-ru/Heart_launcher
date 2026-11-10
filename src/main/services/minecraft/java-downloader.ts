import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { findJava21 } from './java-detector'

let cachedJavaPath: string | null = null

export async function ensureJava21(
  gameDir: string,
  customPath?: string,
  onProgress?: (percent: number, message: string) => void
): Promise<string> {
  // 1. Мгновенный возврат из памяти, если уже проверяли в этой сессии
  if (cachedJavaPath && existsSync(cachedJavaPath)) {
    return cachedJavaPath
  }

  // 2. Проверяем локальную портативную Java в папке лаунчера
  const runtimeDir = join(gameDir, 'runtime', 'java-21')
  const localJava = findJavaInDir(runtimeDir)
  if (localJava) {
    cachedJavaPath = localJava
    return localJava
  }

  // 3. Проверяем указанный пользователем путь или систему
  const existingJava = findJava21(customPath)
  if (existingJava) {
    cachedJavaPath = existingJava.path
    return existingJava.path
  }

  onProgress?.(5, 'Поиск и загрузка портативной Java 21...')
  mkdirSync(runtimeDir, { recursive: true })

  const isWindows = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  const os = isWindows ? 'windows' : isMac ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  const archiveExt = isWindows ? 'zip' : 'tar.gz'
  const archivePath = join(gameDir, 'runtime', `temp_jre21.${archiveExt}`)

  const downloadUrl = `https://api.adoptium.net/v3/binary/latest/21/ga/${os}/${arch}/jre/hotspot/normal/eclipse`

  const response = await fetch(downloadUrl, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Не удалось скачать Java 21 с сервера Adoptium: HTTP ${response.status}`)
  }

  const contentLength = Number(response.headers.get('content-length') || 0)
  let downloadedBytes = 0

  const reader = response.body.getReader()
  const nodeStream = new Readable({
    async read() {
      try {
        const { done, value } = await reader.read()
        if (done) {
          this.push(null)
        } else {
          downloadedBytes += value.length
          if (contentLength > 0) {
            const pct = Math.min(85, 5 + Math.round((downloadedBytes / contentLength) * 80))
            const mb = (downloadedBytes / 1024 / 1024).toFixed(1)
            const totalMb = (contentLength / 1024 / 1024).toFixed(1)
            onProgress?.(pct, `Загрузка Java 21 (${mb} / ${totalMb} МБ)...`)
          }
          this.push(Buffer.from(value))
        }
      } catch (err) {
        this.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    }
  })

  const fileStream = createWriteStream(archivePath)
  await pipeline(nodeStream, fileStream)

  onProgress?.(90, 'Распаковка Java 21 в папку игры...')
  if (isWindows) {
    const tarResult = spawnSync('tar', ['-xf', archivePath, '-C', runtimeDir], { stdio: 'ignore' })
    if (tarResult.error || tarResult.status !== 0) {
      spawnSync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${runtimeDir}' -Force`
      ])
    }
  } else {
    spawnSync('tar', ['-xzf', archivePath, '-C', runtimeDir])
  }

  try { rmSync(archivePath, { force: true }) } catch {}

  const finalJava = findJavaInDir(runtimeDir)
  if (!finalJava) {
    throw new Error('Не удалось найти javaw.exe после распаковки Java 21.')
  }

  cachedJavaPath = finalJava
  onProgress?.(100, 'Java 21 готова к запуску!')
  return finalJava
}

function findJavaInDir(dir: string): string | null {
  if (!existsSync(dir)) return null
  const binaryName = process.platform === 'win32' ? 'javaw.exe' : 'java'
  const fallback = process.platform === 'win32' ? 'java.exe' : 'java'

  const queue = [dir]
  while (queue.length > 0) {
    const current = queue.shift()!
    try {
      const entries = readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) {
          queue.push(full)
        } else if (entry.isFile() && (entry.name === binaryName || entry.name === fallback)) {
          return full
        }
      }
    } catch {}
  }
  return null
}