import type { NewsArticle } from '../../shared/types'
import type { ClientModpackEntry, ResolvedModFile } from './minecraft/modrinth-modpack'

export interface HeartBridgeResourcePackEntry {
  projectId: string
  slug: string
  title: string
  versionId: string
  versionNumber: string
  versionName?: string
  filename: string
  downloadUrl: string
  sha1?: string
  sha512?: string
  fileSize: number
  primaryFile?: boolean
  gameVersions?: string[]
  source?: string
}

export interface HeartBridgeModEntry {
  projectId?: string
  slug: string
  title: string
  versionId: string
  versionNumber?: string
  clientSide?: string
  serverSide?: string
  group?: 'client' | 'shared' | 'library'
  source?: string
  filename?: string
  downloadUrl?: string
  sha1?: string
  sha512?: string
  fileSize?: number
}

export interface HeartBridgeManifest {
  schemaVersion: number
  packId: string
  name: string
  gameVersion: string
  loader: string
  loaderVersion: string
  revision: number
  updatedAt?: string
  mods: HeartBridgeModEntry[]
  resourcePacks?: HeartBridgeResourcePackEntry[]
}

export interface CompanionInfo {
  filename: string
  size: number
  sha256: string
  downloadUrl: string
}

export interface ClientConfigFileInfo {
  path: string
  size: number
  sha256: string
  downloadUrl: string
}

export interface ClientConfigsManifest {
  files: ClientConfigFileInfo[]
}

const DEFAULT_NEWS_COVERS = [
  'worlds/forest-river.webp',
  'worlds/cherry-evening.webp',
  'worlds/village-lake.webp',
  'worlds/sunset-ridge.webp',
  'worlds/pine-mountains.webp',
  'worlds/sunlit-mountains.webp',
  'worlds/green-valley.webp',
  'worlds/alpine-lake.webp'
]

function endpoint(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl)
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('Некорректный адрес HeartBridge API.')
  }
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(base.hostname)
  if (base.protocol !== 'https:' && !(isLocal && base.protocol === 'http:')) {
    throw new Error('HeartBridge API должен использовать HTTPS (HTTP разрешён только для localhost).')
  }
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`
  return new URL(path.replace(/^\//, ''), base)
}

async function getJson<T>(baseUrl: string, path: string, signal?: AbortSignal, timeoutMs = 3500): Promise<T> {
  const url = endpoint(baseUrl, path)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onParentAbort = () => controller.abort()
  if (signal) {
    signal.addEventListener('abort', onParentAbort, { once: true })
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error'
    })
    if (!response.ok) throw new Error(`HeartBridge API вернул HTTP ${response.status} (${path}).`)
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
    if (signal) {
      signal.removeEventListener('abort', onParentAbort)
    }
  }
}

export async function fetchCompanionInfo(baseUrl: string, signal?: AbortSignal): Promise<CompanionInfo | null> {
  try {
    return await getJson<CompanionInfo>(baseUrl, 'v1/companion/info', signal, 3000)
  } catch {
    return null
  }
}

export async function fetchClientConfigsManifest(baseUrl: string, signal?: AbortSignal): Promise<ClientConfigsManifest | null> {
  try {
    return await getJson<ClientConfigsManifest>(baseUrl, 'v1/configs/manifest', signal, 4000)
  } catch {
    return null
  }
}

export async function fetchLocalMods(baseUrl: string, signal?: AbortSignal): Promise<ResolvedModFile[]> {
  try {
    const data = await getJson<{ mods: HeartBridgeModEntry[] }>(baseUrl, 'v1/mods/local', signal, 3500)
    if (!data || !Array.isArray(data.mods)) return []
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    return data.mods.map(mod => ({
      projectId: mod.projectId || `local_${mod.slug}`,
      projectSlug: mod.slug,
      projectName: mod.title || mod.slug,
      versionId: mod.versionId || 'local',
      versionNumber: mod.versionNumber || '1.0.0',
      filename: mod.filename || `${mod.slug}.jar`,
      url: mod.downloadUrl?.startsWith('http')
        ? mod.downloadUrl
        : new URL((mod.downloadUrl || `v1/mods/download/${mod.filename}`).replace(/^\//, ''), base).toString(),
      size: Number(mod.fileSize || 0),
      sha1: mod.sha1,
      sha512: mod.sha512,
      group: 'client' as const
    }))
  } catch {
    return []
  }
}

export async function fetchHeartBridgeModpack(baseUrl: string, signal?: AbortSignal): Promise<{
  manifest: HeartBridgeManifest
  entries: ClientModpackEntry[]
  resourcePacks: HeartBridgeResourcePackEntry[]
  localModFiles: ResolvedModFile[]
}> {
  const manifest = await getJson<HeartBridgeManifest>(baseUrl, 'v1/modpack', signal, 4000)
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.mods)) {
    throw new Error('HeartBridge вернул некорректный манифест модпака.')
  }
  if (!Number.isSafeInteger(manifest.revision) || manifest.revision < 1) {
    throw new Error('У манифеста HeartBridge некорректный номер ревизии.')
  }
  if (typeof manifest.gameVersion !== 'string' || typeof manifest.loader !== 'string' || typeof manifest.loaderVersion !== 'string') {
    throw new Error('В манифесте HeartBridge отсутствует версия Minecraft или загрузчика.')
  }

  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const localModFiles: ResolvedModFile[] = []
  const modrinthEntries: ClientModpackEntry[] = []

  for (const mod of manifest.mods) {
    if (!mod || typeof mod.slug !== 'string') continue

    const isLocal = mod.source === 'local' || (typeof mod.downloadUrl === 'string' && mod.downloadUrl.includes('/v1/mods/download/'))

    if (isLocal) {
      const fullUrl = mod.downloadUrl?.startsWith('http')
        ? mod.downloadUrl
        : new URL((mod.downloadUrl || `v1/mods/download/${mod.filename}`).replace(/^\//, ''), base).toString()

      localModFiles.push({
        projectId: mod.projectId || `local_${mod.slug}`,
        projectSlug: mod.slug,
        projectName: typeof mod.title === 'string' && mod.title.trim() ? mod.title : mod.slug,
        versionId: mod.versionId || 'local',
        versionNumber: mod.versionNumber || '1.0.0',
        filename: mod.filename || `${mod.slug}.jar`,
        url: fullUrl,
        size: Number(mod.fileSize || 0),
        sha1: mod.sha1,
        sha512: mod.sha512,
        group: 'client'
      })
    } else if (mod.versionId && mod.versionId !== 'local') {
      modrinthEntries.push({
        slug: mod.slug,
        name: typeof mod.title === 'string' && mod.title.trim() ? mod.title : mod.slug,
        group: mod.group === 'client' || mod.group === 'shared' || mod.group === 'library'
          ? mod.group
          : mod.serverSide === 'unsupported' ? 'client' : 'shared',
        versionId: mod.versionId
      })
    }
  }

  if (modrinthEntries.length === 0 && localModFiles.length === 0) {
    throw new Error('Список модов HeartBridge пуст. Добавьте моды через /heart mods add <slug> или в папку local_mods.')
  }

  const resourcePacks: HeartBridgeResourcePackEntry[] = Array.isArray(manifest.resourcePacks)
    ? manifest.resourcePacks
        .filter(rp => rp && typeof rp.downloadUrl === 'string' && typeof rp.filename === 'string')
        .map(rp => ({
          projectId: String(rp.projectId),
          slug: String(rp.slug),
          title: String(rp.title || rp.slug),
          versionId: String(rp.versionId),
          versionNumber: String(rp.versionNumber || ''),
          versionName: rp.versionName ? String(rp.versionName) : undefined,
          filename: String(rp.filename),
          downloadUrl: String(rp.downloadUrl),
          sha1: rp.sha1 ? String(rp.sha1) : undefined,
          sha512: rp.sha512 ? String(rp.sha512) : undefined,
          fileSize: Number(rp.fileSize || 0),
          primaryFile: Boolean(rp.primaryFile),
          gameVersions: Array.isArray(rp.gameVersions) ? rp.gameVersions.map(String) : [],
          source: rp.source ? String(rp.source) : 'modrinth'
        }))
    : []

  return { manifest, entries: modrinthEntries, resourcePacks, localModFiles }
}

export async function fetchHeartBridgeNews(baseUrl: string): Promise<NewsArticle[]> {
  const rows = await getJson<Array<{
    id: string
    title: string
    content: string
    author?: string
    createdAt: string
    published?: boolean
    image?: string
  }>>(baseUrl, 'v1/news', undefined, 5000)
  if (!Array.isArray(rows)) throw new Error('HeartBridge вернул некорректный список новостей.')
  return rows.filter(item => item && item.published !== false).map((item, index) => {
    const hasImage = typeof item.image === 'string' && item.image.trim().length > 0
    const finalImage = hasImage ? item.image!.trim() : DEFAULT_NEWS_COVERS[index % DEFAULT_NEWS_COVERS.length]

    return {
      id: String(item.id),
      title: String(item.title),
      excerpt: String(item.content).replace(/\s+/g, ' ').slice(0, 220),
      content: String(item.content),
      category: 'Объявления' as const,
      date: String(item.createdAt),
      image: finalImage
    }
  })
}