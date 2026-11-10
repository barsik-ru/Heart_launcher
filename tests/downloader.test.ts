import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadFilesWithPool, type DownloadPoolProgress } from '../src/main/services/minecraft/downloader'

const temporaryDirectories: string[] = []

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'heart-downloader-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('downloadFilesWithPool cache accounting', () => {
  it('does not count a verified cache hit as network download', async () => {
    const directory = createTempDirectory()
    const destination = join(directory, 'cached.jar')
    const bytes = Buffer.from('already-installed-mod')
    writeFileSync(destination, bytes)
    const sha1 = createHash('sha1').update(bytes).digest('hex')
    const updates: DownloadPoolProgress[] = []

    await downloadFilesWithPool([{
      url: 'https://invalid.example/should-not-be-requested.jar',
      destPath: destination,
      size: bytes.length,
      sha1,
      label: 'Cached mod'
    }], 1, update => updates.push(update))

    expect(updates.at(-1)?.phase).toBe('complete')
    expect(updates.at(-1)?.downloadedBytes).toBe(0)
    expect(updates.at(-1)?.cachedFiles).toBe(1)
    expect(updates.at(-1)?.downloadedFiles).toBe(0)
    expect(updates.at(-1)?.processedBytes).toBe(bytes.length)
  })

  it('downloads only a corrupt cache file and replaces it after hash verification', async () => {
    const directory = createTempDirectory()
    const destination = join(directory, 'broken.jar')
    const bytes = Buffer.from('correct-mod-payload')
    writeFileSync(destination, 'corrupt')
    const sha1 = createHash('sha1').update(bytes).digest('hex')
    const updates: DownloadPoolProgress[] = []
    const url = `data:application/octet-stream;base64,${bytes.toString('base64')}`

    await downloadFilesWithPool([{
      url,
      destPath: destination,
      size: bytes.length,
      sha1,
      label: 'Broken mod'
    }], 1, update => updates.push(update))

    expect(existsSync(destination)).toBe(true)
    expect(readFileSync(destination).equals(bytes)).toBe(true)
    expect(updates.at(-1)?.downloadedBytes).toBe(bytes.length)
    expect(updates.at(-1)?.cachedFiles).toBe(0)
    expect(updates.at(-1)?.downloadedFiles).toBe(1)
  })

  it('handles an empty task list without creating a fake download', async () => {
    const updates: DownloadPoolProgress[] = []
    await downloadFilesWithPool([], 1, update => updates.push(update))
    expect(updates).toHaveLength(1)
    expect(updates[0].phase).toBe('complete')
    expect(updates[0].downloadedBytes).toBe(0)
    expect(updates[0].totalBytes).toBe(0)
  })
})
