import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface MojangRule {
  action: 'allow' | 'disallow'
  os?: {
    name?: 'windows' | 'osx' | 'linux'
    arch?: string
  }
  features?: Record<string, boolean>
}

export interface MojangLibrary {
  name: string
  url?: string
  sha1?: string
  size?: number
  downloads?: {
    artifact?: {
      path: string
      sha1?: string
      size?: number
      url: string
    }
    classifiers?: Record<string, {
      path: string
      sha1?: string
      size?: number
      url: string
    }>
  }
  natives?: Partial<Record<'windows' | 'osx' | 'linux', string>>
  extract?: { exclude?: string[] }
  rules?: MojangRule[]
}

export interface MojangVersionJson {
  id: string
  mainClass: string
  minecraftArguments?: string
  arguments?: {
    game: Array<string | { rules?: MojangRule[]; value: string | string[] }>
    jvm: Array<string | { rules?: MojangRule[]; value: string | string[] }>
  }
  assetIndex?: {
    id: string
    sha1: string
    size: number
    totalSize: number
    url: string
  }
  downloads?: {
    client: {
      sha1: string
      size: number
      url: string
    }
  }
  libraries: MojangLibrary[]
}

export function isRuleAllowed(rules?: MojangRule[]): boolean {
  if (!rules || rules.length === 0) return true
  const currentOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
  const currentArch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : 'x86'

  let allowed = false
  for (const rule of rules) {
    if (rule.features) continue
    let match = true
    if (rule.os) {
      if (rule.os.name && rule.os.name !== currentOs) match = false
      if (rule.os.arch && rule.os.arch !== currentArch) match = false
    }
    if (match) {
      allowed = rule.action === 'allow'
    }
  }
  return allowed
}

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export async function resolveVersionJson(versionId: string, gameDir: string): Promise<MojangVersionJson> {
  const versionDir = join(gameDir, 'versions', versionId)
  const localJsonPath = join(versionDir, `${versionId}.json`)

  if (existsSync(localJsonPath)) {
    try {
      return JSON.parse(readFileSync(localJsonPath, 'utf8')) as MojangVersionJson
    } catch {}
  }

  const manifestResponse = await fetch(MANIFEST_URL)
  if (!manifestResponse.ok) {
    throw new Error(`Не удалось получить манифест Mojang: HTTP ${manifestResponse.status}`)
  }

  const manifest = (await manifestResponse.json()) as { versions: Array<{ id: string; url: string }> }
  const versionEntry = manifest.versions.find(v => v.id === versionId)
  if (!versionEntry) {
    throw new Error(`Версия Minecraft ${versionId} не найдена в официальном манифесте Mojang.`)
  }

  const versionResponse = await fetch(versionEntry.url)
  if (!versionResponse.ok) {
    throw new Error(`Не удалось загрузить параметры версии ${versionId}: HTTP ${versionResponse.status}`)
  }

  const versionJson = (await versionResponse.json()) as MojangVersionJson
  mkdirSync(versionDir, { recursive: true })
  writeFileSync(localJsonPath, JSON.stringify(versionJson, null, 2), 'utf8')

  return versionJson
}