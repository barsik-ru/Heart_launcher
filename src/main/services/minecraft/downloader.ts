import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, renameSync, statSync } from 'node:fs'
import { dirname, basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

export interface DownloadTask {
  url: string
  destPath: string
  size?: number
  sha1?: string
  sha512?: string
  label: string
}

export interface DownloadPoolProgress {
  downloadedBytes: number
  processedBytes: number
  totalBytes: number
  cachedBytes: number
  cachedFiles: number
  downloadedFiles: number
  totalFiles: number
  currentFile: string
  speedBps: number
  phase: 'checking-cache' | 'downloading' | 'complete'
}

async function hashFile(path: string, algorithm: 'sha1' | 'sha512'): Promise<string> {
  const hash = createHash(algorithm)
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

/**
 * Быстрая проверка целостности.
 * Если fastCheck = true, сверяется только наличие и точный размер файла,
 * что экономит драгоценные секунды при ежедневном старте игры.
 */
export async function isValidExistingFile(task: DownloadTask, fastCheck = false): Promise<boolean> {
  if (!existsSync(task.destPath)) return false
  try {
    const size = statSync(task.destPath).size
    if (size < 1 || (task.size !== undefined && size !== task.size)) return false
    if (fastCheck) return true

    if (task.sha1 && (await hashFile(task.destPath, 'sha1')).toLowerCase() !== task.sha1.toLowerCase()) return false
    if (task.sha512 && (await hashFile(task.destPath, 'sha512')).toLowerCase() !== task.sha512.toLowerCase()) return false
    return true
  } catch {
    return false
  }
}

export async function downloadFilesWithPool(
  tasks: DownloadTask[],
  concurrency = 12,
  onProgress?: (progress: DownloadPoolProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const totalBytes = tasks.reduce((sum, task) => sum + (task.size ?? 0), 0)
  const cacheResults: boolean[] = new Array(tasks.length).fill(false)
  let checkIndex = 0
  let checkedFiles = 0
  let cachedFiles = 0
  let cachedBytes = 0
  let processedBytes = 0
  let downloadedBytes = 0
  let downloadedFiles = 0
  let lastReportTime = Date.now()
  let bytesSinceLastReport = 0
  let speedBps = 0

  const emit = (currentFile: string, phase: DownloadPoolProgress['phase']) => {
    const now = Date.now()
    const dt = (now - lastReportTime) / 1000
    if (dt >= 0.25) {
      speedBps = Math.round(bytesSinceLastReport / dt)
      bytesSinceLastReport = 0
      lastReportTime = now
    }
    onProgress?.({
      downloadedBytes,
      processedBytes,
      totalBytes,
      cachedBytes,
      cachedFiles,
      downloadedFiles,
      totalFiles: tasks.length,
      currentFile,
      speedBps,
      phase
    })
  }

  if (tasks.length === 0) {
    onProgress?.({ downloadedBytes: 0, processedBytes: 0, totalBytes: 0, cachedBytes: 0, cachedFiles: 0,
      downloadedFiles: 0, totalFiles: 0, currentFile: 'Нет файлов для загрузки', speedBps: 0, phase: 'complete' })
    return
  }

  const checkWorker = async () => {
    while (checkIndex < tasks.length) {
      if (signal?.aborted) throw new Error('Загрузка отменена пользователем')
      const index = checkIndex++
      const task = tasks[index]
      const valid = await isValidExistingFile(task, false)
      cacheResults[index] = valid
      checkedFiles++
      if (valid) {
        cachedFiles++
        const bytes = task.size ?? statSync(task.destPath).size
        cachedBytes += bytes
        processedBytes += bytes
      }
      emit(`Проверка кеша: ${checkedFiles}/${tasks.length} · найдено ${cachedFiles}`, 'checking-cache')
    }
  }
  const checkWorkers = Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length) }, () => checkWorker())
  await Promise.all(checkWorkers)

  const pending = tasks.filter((_, index) => !cacheResults[index])
  if (pending.length === 0) {
    emit(`Все ${cachedFiles} файлов уже проверены в кеше — повторная загрузка не требуется`, 'complete')
    return
  }

  let taskIndex = 0
  const downloadWorker = async () => {
    while (taskIndex < pending.length) {
      if (signal?.aborted) throw new Error('Загрузка отменена пользователем')
      const task = pending[taskIndex++]
      mkdirSync(dirname(task.destPath), { recursive: true })
      const tempPath = `${task.destPath}.${randomUUID()}.part`
      try {
        const response = await fetch(task.url, { signal, redirect: 'error' })
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status} при загрузке ${task.url}`)
        }

        const reader = response.body.getReader()
        const nodeStream = new Readable({
          async read() {
            try {
              const { done, value } = await reader.read()
              if (done) {
                this.push(null)
              } else {
                downloadedBytes += value.length
                processedBytes += value.length
                bytesSinceLastReport += value.length
                emit(task.label, 'downloading')
                this.push(Buffer.from(value))
              }
            } catch (error) {
              this.destroy(error instanceof Error ? error : new Error(String(error)))
            }
          }
        })

        await pipeline(nodeStream, createWriteStream(tempPath, { flags: 'wx' }), { signal })
        const actualSize = statSync(tempPath).size
        if (task.size !== undefined && actualSize !== task.size) {
          throw new Error(`Размер ${basename(task.destPath)} не совпадает: ожидалось ${task.size}, получено ${actualSize}`)
        }
        if (task.sha1 && (await hashFile(tempPath, 'sha1')).toLowerCase() !== task.sha1.toLowerCase()) {
          throw new Error(`SHA-1 не совпадает для ${basename(task.destPath)}`)
        }
        if (task.sha512 && (await hashFile(tempPath, 'sha512')).toLowerCase() !== task.sha512.toLowerCase()) {
          throw new Error(`SHA-512 не совпадает для ${basename(task.destPath)}`)
        }
        rmSync(task.destPath, { force: true })
        renameSync(tempPath, task.destPath)
        downloadedFiles++
        emit(`Загружено: ${task.label}`, 'downloading')
      } catch (error) {
        try { rmSync(tempPath, { force: true }) } catch {}
        if (signal?.aborted) throw new Error('Загрузка отменена')
        throw error
      }
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), pending.length) }, () => downloadWorker())
  await Promise.all(workers)
  emit(`Готово: ${cachedFiles} из кеша, ${downloadedFiles} загружено`, 'complete')
}