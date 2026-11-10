import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getFabricVersionId, hasFabricLoaderProfile } from '../src/main/services/minecraft/fabric-manifest'

const temporaryDirs: string[] = []

function createGameDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heart-fabric-profile-'))
  temporaryDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Fabric loader profile detection', () => {
  it('recognizes an already installed older loader profile', () => {
    const gameDir = createGameDir()
    const id = getFabricVersionId('1.21.11', '0.18.4')
    const versionDir = join(gameDir, 'versions', id)
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(join(versionDir, `${id}.json`), JSON.stringify({
      id,
      inheritsFrom: '1.21.11',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      libraries: []
    }))

    expect(hasFabricLoaderProfile(gameDir, '1.21.11', '0.18.4')).toBe(true)
    expect(hasFabricLoaderProfile(gameDir, '1.21.11', '0.19.5')).toBe(false)
  })

  it('rejects malformed or mismatched profiles', () => {
    const gameDir = createGameDir()
    const id = getFabricVersionId('1.21.11', '0.19.5')
    const versionDir = join(gameDir, 'versions', id)
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(join(versionDir, `${id}.json`), JSON.stringify({ id, inheritsFrom: '1.21.10', mainClass: 'x', libraries: [] }))

    expect(hasFabricLoaderProfile(gameDir, '1.21.11', '0.19.5')).toBe(false)
    expect(hasFabricLoaderProfile(gameDir, '1.21.11', '../bad')).toBe(false)
  })
})
