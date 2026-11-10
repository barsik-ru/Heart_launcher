import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MojangVersionJson } from './mojang-manifest'

export interface FabricProfileJson extends MojangVersionJson {
  inheritsFrom: string
}

export function getFabricVersionId(gameVersion: string, loaderVersion: string): string {
  return `fabric-loader-${loaderVersion}-${gameVersion}`
}

export function hasFabricLoaderProfile(gameDir: string, gameVersion: string, loaderVersion: string): boolean {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(loaderVersion)) return false
  const id = getFabricVersionId(gameVersion, loaderVersion)
  const localPath = join(gameDir, 'versions', id, `${id}.json`)
  if (!existsSync(localPath)) return false

  try {
    const profile = JSON.parse(readFileSync(localPath, 'utf8')) as Partial<FabricProfileJson>
    return profile.id === id && profile.inheritsFrom === gameVersion
      && typeof profile.mainClass === 'string' && Array.isArray(profile.libraries)
  } catch {
    return false
  }
}

export async function resolveFabricVersionJson(
  gameVersion: string,
  loaderVersion: string,
  gameDir: string,
  signal?: AbortSignal
): Promise<FabricProfileJson> {
  const id = getFabricVersionId(gameVersion, loaderVersion)
  const versionDir = join(gameDir, 'versions', id)
  const localPath = join(versionDir, `${id}.json`)

  if (existsSync(localPath)) {
    try {
      const cached = JSON.parse(readFileSync(localPath, 'utf8')) as FabricProfileJson
      if (cached.id === id && cached.inheritsFrom === gameVersion && cached.mainClass && Array.isArray(cached.libraries)) {
        return cached
      }
    } catch {}
  }

  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Не удалось получить профиль Fabric Loader ${loaderVersion}: HTTP ${response.status}`)
  }
  const profile = await response.json() as FabricProfileJson
  if (profile.id !== id || profile.inheritsFrom !== gameVersion || !profile.mainClass || !Array.isArray(profile.libraries)) {
    throw new Error('Fabric Meta вернул некорректный профиль загрузчика.')
  }

  mkdirSync(versionDir, { recursive: true })
  writeFileSync(localPath, JSON.stringify(profile, null, 2), 'utf8')
  return profile
}
