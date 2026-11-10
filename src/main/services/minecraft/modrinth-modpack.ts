import { brand } from '../../../shared/config/brand'

const MODRINTH_API = 'https://api.modrinth.com/v2'
const MODRINTH_CDN_HOST = 'cdn.modrinth.com'

/** Bump whenever the curated client list or its pinned versions change. */
export const CLIENT_PACK_REVISION = 3

/** Mods intended for the player's local client. Server-only utilities are deliberately excluded. */
export interface ClientModpackEntry {
  slug: string
  name: string
  group: 'client' | 'shared' | 'library'
  /** Optional prefix used to keep shared content in sync with the backend mod set. */
  versionNumberPrefix?: string
  /** Exact Modrinth version selected by HeartBridge, used to keep shared mods in sync. */
  versionId?: string
}

export const CLIENT_MODPACK: readonly ClientModpackEntry[] = [
  { slug: 'ambientsounds', name: 'AmbientSounds', group: 'client' },
  { slug: 'cosy-critters', name: 'Cosy Critters & Creepy Crawlies', group: 'client' },
  { slug: 'fallingleaves', name: 'Falling Leaves', group: 'client' },
  { slug: 'particle-rain', name: 'Particle Rain', group: 'client' },
  { slug: 'presence-footsteps', name: 'Presence Footsteps', group: 'client' },
  { slug: 'visuality', name: 'Visuality', group: 'client' },
  { slug: 'sound-physics-remastered', name: 'Sound Physics Remastered', group: 'client' },
  { slug: 'iris', name: 'Iris Shaders', group: 'client' },
  { slug: 'sodium', name: 'Sodium', group: 'client' },
  { slug: 'entityculling', name: 'Entity Culling', group: 'client' },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', group: 'client' },
  { slug: 'dynamic-fps', name: 'Dynamic FPS', group: 'client' },
  { slug: 'modmenu', name: 'Mod Menu', group: 'client' },
  { slug: 'ferrite-core', name: 'FerriteCore', group: 'shared', versionNumberPrefix: '8.2.0' },
  { slug: 'lithium', name: 'Lithium', group: 'shared', versionNumberPrefix: 'mc1.21.11-0.21.4' },
  { slug: 'alexs-mobs-continued', name: "Alex's Mobs Continued", group: 'shared', versionNumberPrefix: '2.2.2+1.21.11' },
  { slug: 'codxlib', name: 'CodxLib', group: 'library' },
  { slug: 'immersive-ores', name: 'Immersive Ores', group: 'shared', versionNumberPrefix: '1.21.11-0.3' },
  { slug: 'fabric-api', name: 'Fabric API', group: 'library', versionNumberPrefix: '0.141.6+1.21.11' },
  { slug: 'cloth-config', name: 'Cloth Config', group: 'library', versionNumberPrefix: '21.11.153' },
  { slug: 'creativecore', name: 'CreativeCore', group: 'library', versionNumberPrefix: '2.14.11' },
  { slug: 'fabric-language-kotlin', name: 'Fabric Language Kotlin', group: 'library', versionNumberPrefix: '1.14.2+kotlin.2.4.21' },
  { slug: 'travelersbackpack', name: "Traveler's Backpack", group: 'shared' }
]

export interface ResolvedModFile {
  projectId: string
  projectSlug: string
  projectName: string
  versionId: string
  versionNumber: string
  filename: string
  url: string
  size: number
  sha1?: string
  sha512?: string
  group: 'client' | 'shared' | 'library'
}

interface ModrinthProject {
  id: string
  slug: string
  title: string
  client_side: 'required' | 'optional' | 'unsupported' | 'unknown'
  server_side: 'required' | 'optional' | 'unsupported' | 'unknown'
}

interface ModrinthFile {
  hashes: { sha1?: string; sha512?: string }
  url: string
  filename: string
  primary: boolean
  size: number
}

interface ModrinthDependency {
  version_id: string | null
  project_id: string | null
  file_name: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

interface ModrinthVersion {
  id: string
  project_id: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions: string[]
  loaders: string[]
  files: ModrinthFile[]
  dependencies: ModrinthDependency[]
}

const projectCache = new Map<string, Promise<ModrinthProject>>()
const versionCache = new Map<string, Promise<ModrinthVersion>>()
const compatibleVersionCache = new Map<string, Promise<ModrinthVersion>>()

function assertTrustedUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Modrinth вернул небезопасную ссылку загрузки.')
  }
  if (url.hostname !== 'api.modrinth.com' && url.hostname !== MODRINTH_CDN_HOST) {
    throw new Error(`Неожиданный домен Modrinth: ${url.hostname}`)
  }
  return url
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const parsed = assertTrustedUrl(url)
  const response = await fetch(parsed, {
    signal,
    headers: { 'User-Agent': `HeartLauncher/${brand.version} (Minecraft client installer)` }
  })
  if (!response.ok) {
    throw new Error(`Modrinth API вернул HTTP ${response.status}: ${parsed.pathname}`)
  }
  return (await response.json()) as T
}

function apiUrl(path: string): string {
  return new URL(path, `${MODRINTH_API}/`).toString()
}

async function getProject(identifier: string, signal?: AbortSignal): Promise<ModrinthProject> {
  const existing = projectCache.get(identifier)
  if (existing) return existing
  const request = requestJson<ModrinthProject>(apiUrl(`project/${encodeURIComponent(identifier)}`), signal)
  projectCache.set(identifier, request)
  try {
    return await request
  } catch (error) {
    projectCache.delete(identifier)
    throw error
  }
}

async function getVersion(versionId: string, signal?: AbortSignal): Promise<ModrinthVersion> {
  const existing = versionCache.get(versionId)
  if (existing) return existing
  const request = requestJson<ModrinthVersion>(apiUrl(`version/${encodeURIComponent(versionId)}`), signal)
  versionCache.set(versionId, request)
  try {
    return await request
  } catch (error) {
    versionCache.delete(versionId)
    throw error
  }
}

async function getCompatibleVersion(
  projectIdOrSlug: string,
  gameVersion: string,
  signal?: AbortSignal,
  versionNumberPrefix?: string
): Promise<ModrinthVersion> {
  const cacheKey = `${projectIdOrSlug}:${gameVersion}:${versionNumberPrefix ?? 'latest-release'}`
  const existing = compatibleVersionCache.get(cacheKey)
  if (existing) return existing

  const request = (async () => {
    const params = new URLSearchParams({
      loaders: JSON.stringify(['fabric']),
      game_versions: JSON.stringify([gameVersion]),
      include_changelog: 'false'
    })
    const versions = await requestJson<ModrinthVersion[]>(apiUrl(`project/${encodeURIComponent(projectIdOrSlug)}/version?${params.toString()}`), signal)
    const compatible = versions.filter(version =>
      version.loaders.includes('fabric') && version.game_versions.includes(gameVersion)
    )
    const pool = versionNumberPrefix
      ? compatible.filter(version => version.version_number.startsWith(versionNumberPrefix))
      : compatible
    const selected = pool.find(version => version.version_type === 'release') ?? pool[0]
    if (!selected) {
      const requirement = versionNumberPrefix ? ` версии ${versionNumberPrefix} ` : ' '
      throw new Error(`Для ${projectIdOrSlug}${requirement}нет Fabric-релиза Minecraft ${gameVersion}. Проверьте, что версия совпадает с серверной сборкой.`)
    }
    return selected
  })()

  compatibleVersionCache.set(cacheKey, request)
  try {
    return await request
  } catch (error) {
    compatibleVersionCache.delete(cacheKey)
    throw error
  }
}

function getPrimaryJar(version: ModrinthVersion): ModrinthFile {
  const jars = version.files.filter(file => file.filename.toLowerCase().endsWith('.jar'))
  const file = jars.find(candidate => candidate.primary) ?? jars[0]
  if (!file) throw new Error(`В версии ${version.version_number} отсутствует JAR-файл.`)
  const url = assertTrustedUrl(file.url)
  if (url.hostname !== MODRINTH_CDN_HOST) throw new Error('Файл мода размещён не на CDN Modrinth.')
  if (!Number.isSafeInteger(file.size) || file.size < 1) throw new Error(`Некорректный размер файла ${file.filename}.`)
  if (!/^[a-zA-Z0-9._+ -]+\.jar$/i.test(file.filename) || file.filename.includes('..')) {
    throw new Error(`Недопустимое имя файла мода: ${file.filename}`)
  }
  return file
}

/** Resolves the curated client pack and every required Modrinth dependency. */
export async function resolveClientModpack(
  gameVersion: string,
  signal?: AbortSignal,
  onMessage?: (message: string) => void,
  rootEntries: readonly ClientModpackEntry[] = CLIENT_MODPACK
): Promise<ResolvedModFile[]> {
  const resolved = new Map<string, ResolvedModFile>()
  const visiting = new Set<string>()

  // Быстрая карта модов манифеста сервера для проверки зависимостей
  const rootEntryMap = new Map<string, ClientModpackEntry>()
  for (const entry of rootEntries) {
    if (entry.slug) rootEntryMap.set(entry.slug.toLowerCase(), entry)
  }

  const addVersion = async (
    project: ModrinthProject,
    version: ModrinthVersion,
    group: ResolvedModFile['group']
  ): Promise<void> => {
    if (version.project_id !== project.id) {
      throw new Error(`Modrinth вернул неверную зависимость для ${project.title}.`)
    }
    if (!version.game_versions.includes(gameVersion) || !version.loaders.includes('fabric')) {
      throw new Error(`Зависимость ${project.title} не совместима с Fabric ${gameVersion}.`)
    }

    const previous = resolved.get(project.id)
    if (previous) {
      if (previous.versionId !== version.id) {
        // Проверяем, зафиксирована ли текущая или прошлая версия в манифесте сервера
        const isCurrentRoot = rootEntries.some(
          r => r.versionId === version.id || r.slug?.toLowerCase() === project.slug.toLowerCase()
        )
        const isPreviousRoot = rootEntries.some(
          r => r.versionId === previous.versionId || r.slug?.toLowerCase() === previous.projectSlug.toLowerCase()
        )

        if (isCurrentRoot && !isPreviousRoot) {
          // Корневой мод из манифеста заменяет транзитивную зависимость
          onMessage?.(
            `Уточнение версии ${project.title}: транзитивная версия (${previous.versionNumber}) заменена на версию из манифеста (${version.version_number}).`
          )
          const file = getPrimaryJar(version)
          resolved.set(project.id, {
            projectId: project.id,
            projectSlug: project.slug,
            projectName: project.title,
            versionId: version.id,
            versionNumber: version.version_number,
            filename: file.filename,
            url: file.url,
            size: file.size,
            sha1: file.hashes.sha1,
            sha512: file.hashes.sha512,
            group
          })
        } else {
          onMessage?.(
            `Совпадение зависимости ${project.title}: используется ${previous.versionNumber} (запрошена ${version.version_number}).`
          )
        }
      }
      return
    }

    if (visiting.has(project.id)) return

    // Не пропускаем CodxLib, так как он необходим Alex's Mobs на клиенте
    if (project.client_side === 'unsupported' && project.slug !== 'codxlib') {
      onMessage?.(`Пропуск ${project.title}: Modrinth помечает зависимость как server-side only; она не будет установлена в клиентскую папку mods.`)
      return
    }

    visiting.add(project.id)
    const file = getPrimaryJar(version)
    resolved.set(project.id, {
      projectId: project.id,
      projectSlug: project.slug,
      projectName: project.title,
      versionId: version.id,
      versionNumber: version.version_number,
      filename: file.filename,
      url: file.url,
      size: file.size,
      sha1: file.hashes.sha1,
      sha512: file.hashes.sha512,
      group
    })

    for (const dependency of version.dependencies ?? []) {
      if (dependency.dependency_type !== 'required') continue

      if (dependency.version_id) {
        let dependencyVersion = await getVersion(dependency.version_id, signal)
        const dependencyProject = await getProject(dependencyVersion.project_id, signal)
        if (dependencyProject.client_side === 'unsupported' && dependencyProject.slug !== 'codxlib') {
          onMessage?.(`Пропуск обязательной зависимости ${dependencyProject.title}: она предназначена для backend-сервера, а не клиента.`)
          continue
        }

        // Если для этого проекта в манифесте сервера зафиксирована другая версия — используем её
        const rootEntry = rootEntryMap.get(dependencyProject.slug.toLowerCase()) || rootEntryMap.get(dependencyProject.id.toLowerCase())
        if (rootEntry?.versionId && rootEntry.versionId !== 'local' && rootEntry.versionId !== dependency.version_id) {
          dependencyVersion = await getVersion(rootEntry.versionId, signal)
        }

        await addVersion(dependencyProject, dependencyVersion, 'library')
      } else if (dependency.project_id) {
        const dependencyProject = await getProject(dependency.project_id, signal)
        if (dependencyProject.client_side === 'unsupported' && dependencyProject.slug !== 'codxlib') {
          onMessage?.(`Пропуск обязательной зависимости ${dependencyProject.title}: она предназначена для backend-сервера, а не клиента.`)
          continue
        }

        // Проверяем наличие зафиксированной версии в манифесте сервера
        const rootEntry = rootEntryMap.get(dependencyProject.slug.toLowerCase()) || rootEntryMap.get(dependencyProject.id.toLowerCase())
        let dependencyVersion: ModrinthVersion
        if (rootEntry?.versionId && rootEntry.versionId !== 'local') {
          dependencyVersion = await getVersion(rootEntry.versionId, signal)
        } else {
          dependencyVersion = await getCompatibleVersion(
            dependencyProject.id,
            gameVersion,
            signal,
            rootEntry?.versionNumberPrefix
          )
        }

        await addVersion(dependencyProject, dependencyVersion, 'library')
      }
    }

    visiting.delete(project.id)
  }

  // Фильтруем любые записи со спец-версией local, чтобы не запрашивать Modrinth
  const validEntries = rootEntries.filter(item => item.versionId !== 'local')

  const rootCandidates = await Promise.all(validEntries.map(async item => {
    onMessage?.(`Проверка ${item.name} на Modrinth...`)
    const project = await getProject(item.slug, signal)
    if (project.client_side === 'unsupported' && item.slug !== 'codxlib') {
      return { item, project, version: null }
    }
    const version = item.versionId
      ? await getVersion(item.versionId, signal)
      : await getCompatibleVersion(project.id, gameVersion, signal, item.versionNumberPrefix)
    return { item, project, version }
  }))

  for (const candidate of rootCandidates) {
    if (!candidate.version) {
      onMessage?.(`Пропуск ${candidate.project.title}: автор указал server-only.`)
      continue
    }
    await addVersion(candidate.project, candidate.version, candidate.item.group)
  }

  const filenames = new Map<string, string>()
  for (const file of resolved.values()) {
    const normalized = file.filename.toLowerCase()
    const previous = filenames.get(normalized)
    if (previous && previous !== file.projectId) {
      throw new Error(`Два мода используют одинаковое имя файла: ${file.filename}`)
    }
    filenames.set(normalized, file.projectId)
  }

  return [...resolved.values()]
}