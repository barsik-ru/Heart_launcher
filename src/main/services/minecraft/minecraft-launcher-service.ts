import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, chmodSync, copyFileSync } from 'node:fs'
import { join, resolve, sep, dirname } from 'node:path'
import extractZip from 'extract-zip'
import { brand } from '../../../shared/config/brand'
import type { LauncherService, SettingsService } from '../../../shared/contracts/services'
import type {
  GameLogEvent,
  GameProcessEvent,
  InstallationInfo,
  LauncherStatus,
  ProgressEvent,
  UserProfile,
  MinecraftTicketGrant
} from '../../../shared/types'
import { downloadFilesWithPool, isValidExistingFile, type DownloadTask } from './downloader'
import { ensureJava21 } from './java-downloader'
import { isRuleAllowed, resolveVersionJson, type MojangLibrary, type MojangVersionJson } from './mojang-manifest'
import { getOfflinePlayerUuid } from './offline-uuid'
import { getFabricVersionId, hasFabricLoaderProfile, resolveFabricVersionJson } from './fabric-manifest'
import { CLIENT_MODPACK, CLIENT_PACK_REVISION, resolveClientModpack, type ResolvedModFile } from './modrinth-modpack'
import {
  fetchCompanionInfo,
  fetchHeartBridgeModpack,
  fetchClientConfigsManifest,
  type HeartBridgeResourcePackEntry
} from '../heart-bridge-client'

function mergeFabricProfile(base: MojangVersionJson, fabric: MojangVersionJson): MojangVersionJson {
  const baseArguments = base.arguments
  const fabricArguments = fabric.arguments
  return {
    ...base,
    ...fabric,
    id: fabric.id,
    mainClass: fabric.mainClass,
    assetIndex: base.assetIndex,
    downloads: base.downloads,
    libraries: [...base.libraries, ...fabric.libraries],
    arguments: baseArguments || fabricArguments ? {
      jvm: [...(baseArguments?.jvm ?? []), ...(fabricArguments?.jvm ?? [])],
      game: [...(baseArguments?.game ?? []), ...(fabricArguments?.game ?? [])]
    } : undefined
  }
}

function getMavenArtifact(library: MojangLibrary): { path: string; url: string } | null {
  const [coordinate, extension = 'jar'] = library.name.split('@')
  const parts = coordinate.split(':')
  if (parts.length < 3) return null
  const [group, artifact, version, classifier] = parts
  const fileName = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${extension}`
  const path = `${group.replace(/\./g, '/')}/${artifact}/${version}/${fileName}`
  const baseUrl = library.url ?? 'https://libraries.minecraft.net/'
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const url = new URL(path, base)
  if (url.protocol !== 'https:' || !['libraries.minecraft.net', 'maven.fabricmc.net'].includes(url.hostname)) {
    throw new Error(`Fabric profile содержит библиотеку с неизвестного домена: ${url.hostname}`)
  }
  return { path, url: url.toString() }
}

interface ManagedClientModpackManifest {
  manifestVersion: number
  packRevision?: number
  source?: string
  packVersion?: string
  fabricLoaderVersion?: string
  installedAt?: string
  files?: Array<{ filename?: string; versionId?: string; size?: number; sha1?: string; sha512?: string }>
  resourcePacks?: Array<{ filename?: string; versionId?: string; size?: number; sha1?: string; sha512?: string }>
}

function createClientPackVersion(gameVersion: string, loaderVersion: string, files: Array<{ projectSlug: string; versionId: string }>): string {
  const identity = files.map(file => `${file.projectSlug}@${file.versionId}`).sort().join('\n')
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 8)
  return `${gameVersion}-fabric.${loaderVersion}+${digest}`
}

function readManagedClientModpack(gameDir: string): ManagedClientModpackManifest | null {
  const path = join(gameDir, 'heart-launcher', 'client-mods.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ManagedClientModpackManifest
    if (parsed.manifestVersion !== 1 || !Number.isSafeInteger(parsed.packRevision) || !Array.isArray(parsed.files) || parsed.files.length === 0) return null
    const safeFiles = parsed.files.filter(file => typeof file.filename === 'string'
      && /^[a-zA-Z0-9._+ -]+\.jar$/i.test(file.filename)
      && !file.filename.includes('..'))
    if (safeFiles.length !== parsed.files.length) return null
    if (!safeFiles.every(file => existsSync(join(gameDir, 'mods', file.filename!)))) return null
    return parsed
  } catch {
    return null
  }
}

function createServerCompound(name: string, ip: string): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const ipBuf = Buffer.from(ip, 'utf8')

  return Buffer.concat([
    Buffer.from([0x08, 0x00, 0x04, 0x6e, 0x61, 0x6d, 0x65]),
    Buffer.from([nameBuf.length >> 8, nameBuf.length & 0xff]),
    nameBuf,
    Buffer.from([0x08, 0x00, 0x02, 0x69, 0x70]),
    Buffer.from([ipBuf.length >> 8, ipBuf.length & 0xff]),
    ipBuf,
    Buffer.from([0x01, 0x00, 0x0e, ...Buffer.from('acceptTextures', 'utf8'), 0x01]),
    Buffer.from([0x00])
  ])
}

export function ensureServerInServersDat(gameDir: string, serverName = 'Heart', serverIp = '87.228.56.12:25565'): void {
  const filePath = join(gameDir, 'servers.dat')
  const serverCompound = createServerCompound(serverName, serverIp)

  if (!existsSync(filePath)) {
    const freshDat = Buffer.concat([
      Buffer.from([0x0a, 0x00, 0x00]),
      Buffer.from([0x09, 0x00, 0x07, ...Buffer.from('servers', 'utf8')]),
      Buffer.from([0x0a, 0x00, 0x00, 0x00, 0x01]),
      serverCompound,
      Buffer.from([0x00])
    ])
    try {
      writeFileSync(filePath, freshDat)
    } catch {}
    return
  }

  try {
    const data = readFileSync(filePath)
    if (data.includes(Buffer.from(serverIp, 'utf8')) || data.includes(Buffer.from('87.228.56.12', 'utf8'))) {
      return
    }

    const serversMarker = Buffer.from([0x09, 0x00, 0x07, ...Buffer.from('servers', 'utf8'), 0x0a])
    const idx = data.indexOf(serversMarker)
    if (idx !== -1) {
      const countOffset = idx + serversMarker.length
      if (countOffset + 4 <= data.length) {
        const currentCount = data.readInt32BE(countOffset)
        const updatedCount = currentCount + 1
        const countBuf = Buffer.alloc(4)
        countBuf.writeInt32BE(updatedCount, 0)

        const updatedData = Buffer.concat([
          data.subarray(0, countOffset),
          countBuf,
          serverCompound,
          data.subarray(countOffset + 4)
        ])
        writeFileSync(filePath, updatedData)
      }
    }
  } catch {}
}

interface MinecraftLauncherServiceOptions {
  settingsService: SettingsService
  getProfile: () => Promise<UserProfile | null> | UserProfile | null
  getMinecraftGrant?: () => Promise<MinecraftTicketGrant | null>
  defaultGameDir: string
  heartBridgeApiBaseUrl?: string
  minecraftServerAddress?: string
  minecraftServerAddresses?: string[]
  companionModJarPath?: string
  onWindowMinimizeRequest?: () => void
  onWindowRestoreRequest?: () => void
  onWindowHideRequest?: () => void
}

export class MinecraftLauncherService implements LauncherService {
  private status: LauncherStatus = { state: 'idle', progress: null, error: null, activeOperationId: null }
  private activeProcess: ChildProcess | null = null
  private abortController: AbortController | null = null

  private lastModpackCheckTime = 0
  private lastRemoteRevision: number | null = null
  private companionVerified = false
  private configsVerified = false

  private readonly progressListeners = new Set<(event: ProgressEvent) => void>()
  private readonly logListeners = new Set<(event: GameLogEvent) => void>()
  private readonly stateListeners = new Set<(state: LauncherStatus) => void>()
  private readonly processListeners = new Set<(event: GameProcessEvent) => void>()

  constructor(private readonly options: MinecraftLauncherServiceOptions) {}

  private async ensureCompanionMod(gameDir: string, signal?: AbortSignal, forceCheck = false): Promise<boolean> {
    const modsDirectory = join(gameDir, 'mods')
    mkdirSync(modsDirectory, { recursive: true })
    const targetFile = join(modsDirectory, 'heart-identity-fabric.jar')

    if (this.companionVerified && existsSync(targetFile) && !forceCheck) {
      return false
    }

    const bridgeUrl = this.options.heartBridgeApiBaseUrl?.trim()
    if (bridgeUrl) {
      try {
        const info = await fetchCompanionInfo(bridgeUrl, signal)
        if (info && info.downloadUrl) {
          let needDownload = true
          if (existsSync(targetFile)) {
            const currentHash = createHash('sha256').update(readFileSync(targetFile)).digest('hex')
            if (currentHash.toLowerCase() === info.sha256.toLowerCase()) {
              needDownload = false
            }
          }

          if (needDownload) {
            this.emitLog('INFO', 'Загрузка обновленного Heart Identity Companion с сервера...')
            const base = bridgeUrl.endsWith('/') ? bridgeUrl : `${bridgeUrl}/`
            const downloadUrl = new URL(info.downloadUrl.replace(/^\//, ''), base).toString()
            const response = await fetch(downloadUrl, { signal })
            if (response.ok) {
              const buffer = Buffer.from(await response.arrayBuffer())
              writeFileSync(targetFile, buffer)
              this.emitLog('INFO', `Heart Identity Companion успешно загружен (${buffer.length} байт).`)
              this.companionVerified = true
              return true
            }
          } else {
            this.companionVerified = true
            return false
          }
        }
      } catch (err) {
        this.emitLog('WARN', `Проверка Companion через API пропущена: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const companionSource = this.options.companionModJarPath
    if (companionSource && existsSync(companionSource)) {
      if (!existsSync(targetFile)) {
        copyFileSync(companionSource, targetFile)
        this.emitLog('INFO', 'Установлен локальный Heart Identity Fabric Companion.')
        this.companionVerified = true
        return true
      }
    }

    this.companionVerified = existsSync(targetFile)
    return false
  }

  private async ensureClientConfigs(gameDir: string, signal?: AbortSignal, forceCheck = false): Promise<boolean> {
    if (this.configsVerified && !forceCheck) {
      return false
    }

    const bridgeUrl = this.options.heartBridgeApiBaseUrl?.trim()
    if (!bridgeUrl) {
      return false
    }

    try {
      const manifest = await fetchClientConfigsManifest(bridgeUrl, signal)
      if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
        this.configsVerified = true
        return false
      }

      const configDirectory = join(gameDir, 'config')
      mkdirSync(configDirectory, { recursive: true })

      let updatedCount = 0

      for (const file of manifest.files) {
        if (!file.path || typeof file.path !== 'string') continue

        let relativePath = file.path.replace(/\\/g, '/').replace(/^\/+/, '')
        if (relativePath.startsWith('config/')) {
          relativePath = relativePath.slice('config/'.length)
        }

        const targetPath = resolve(configDirectory, relativePath)
        if (!targetPath.startsWith(configDirectory + sep) && targetPath !== configDirectory) {
          this.emitLog('WARN', `Пропущен небезопасный путь конфигурации: ${file.path}`)
          continue
        }

        let needDownload = true
        if (existsSync(targetPath)) {
          try {
            const currentHash = createHash('sha256').update(readFileSync(targetPath)).digest('hex')
            if (currentHash.toLowerCase() === file.sha256.toLowerCase()) {
              needDownload = false
            }
          } catch {
            needDownload = true
          }
        }

        if (needDownload) {
          const base = bridgeUrl.endsWith('/') ? bridgeUrl : `${bridgeUrl}/`
          const downloadUrl = new URL(file.downloadUrl.replace(/^\//, ''), base).toString()

          this.emitLog('INFO', `Загрузка конфигурации: ${relativePath}...`)
          const response = await fetch(downloadUrl, { signal })
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} при загрузке ${relativePath}`)
          }

          const buffer = Buffer.from(await response.arrayBuffer())

          if (file.sha256) {
            const downloadedHash = createHash('sha256').update(buffer).digest('hex')
            if (downloadedHash.toLowerCase() !== file.sha256.toLowerCase()) {
              throw new Error(`Хеш SHA-256 не совпадает для ${relativePath}`)
            }
          }

          mkdirSync(dirname(targetPath), { recursive: true })
          writeFileSync(targetPath, buffer)
          updatedCount++
        }
      }

      if (updatedCount > 0) {
        this.emitLog('INFO', `Синхронизировано клиентских конфигов/пресетов: ${updatedCount}.`)
      }
      this.configsVerified = true
      return updatedCount > 0
    } catch (err) {
      this.emitLog('WARN', `Синхронизация конфигов через API пропущена: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  private async resolveActiveModpack(signal?: AbortSignal, onMessage?: (message: string) => void): Promise<{
    files: ResolvedModFile[]
    revision: number
    source: string
    resourcePacks: HeartBridgeResourcePackEntry[]
  }> {
    const bridgeUrl = this.options.heartBridgeApiBaseUrl?.trim()
    if (bridgeUrl) {
      const { manifest, entries, resourcePacks, localModFiles } = await fetchHeartBridgeModpack(bridgeUrl, signal)
      if (manifest.gameVersion !== brand.game.minecraftVersion) {
        throw new Error(`Серверная сборка использует Minecraft ${manifest.gameVersion}, а лаунчер подготовлен для ${brand.game.minecraftVersion}.`)
      }
      if (manifest.loader.toLowerCase() !== 'fabric') {
        throw new Error(`HeartBridge сообщил загрузчик ${manifest.loader}; сейчас лаунчер поддерживает только Fabric.`)
      }
      if (manifest.loaderVersion !== brand.game.fabricVersion) {
        throw new Error(`Fabric на сервере ${manifest.loaderVersion}, а лаунчер собран для ${brand.game.fabricVersion}.`)
      }

      // 1. Скачиваем моды с Modrinth (если они есть в списке)
      const modrinthFiles = entries.length > 0
        ? await resolveClientModpack(brand.game.minecraftVersion, signal, onMessage, entries)
        : []

      // 2. Объединяем с локальными модами с сервера HeartBridge (heart-overlay и др.)
      const allFilesMap = new Map<string, ResolvedModFile>()
      for (const file of modrinthFiles) {
        allFilesMap.set(file.filename.toLowerCase(), file)
      }
      for (const localMod of localModFiles) {
        allFilesMap.set(localMod.filename.toLowerCase(), localMod)
      }

      this.lastRemoteRevision = manifest.revision
      this.lastModpackCheckTime = Date.now()
      return {
        files: Array.from(allFilesMap.values()),
        revision: manifest.revision,
        source: 'HeartBridge',
        resourcePacks
      }
    }

    const files = await resolveClientModpack(brand.game.minecraftVersion, signal, onMessage)
    this.lastRemoteRevision = CLIENT_PACK_REVISION
    this.lastModpackCheckTime = Date.now()
    return { files, revision: CLIENT_PACK_REVISION, source: 'Curated Modrinth list', resourcePacks: [] }
  }

  private async getGameDir(): Promise<string> {
    const settings = await this.options.settingsService.getSettings()
    return settings.gamePath && settings.gamePath.trim() ? settings.gamePath.trim() : this.options.defaultGameDir
  }

  private emitLog(level: GameLogEvent['level'], message: string, source: GameLogEvent['source'] = 'launcher') {
    const event: GameLogEvent = { timestamp: Date.now(), level, source, message }
    for (const listener of this.logListeners) {
      try { listener(event) } catch {}
    }
  }

  private setState(next: LauncherStatus) {
    this.status = next
    for (const listener of this.stateListeners) {
      try { listener({ ...next, progress: next.progress ? { ...next.progress } : null }) } catch {}
    }
  }

  private setLaunchStep(stepName: string) {
    const progress: ProgressEvent = {
      operationId: 'launch-init',
      operation: 'install',
      stage: 'prepare',
      progress: 100,
      downloadedBytes: 0,
      totalBytes: 0,
      currentFile: stepName,
      downloadSpeed: 0,
      timestamp: Date.now()
    }
    this.setState({ state: 'launching', progress, error: null })
  }

  async getStatus(): Promise<LauncherStatus> {
    return { ...this.status }
  }

  async getInstallationInfo(): Promise<InstallationInfo> {
    const gameDir = await this.getGameDir()
    const version = brand.game.minecraftVersion
    const loaderVersion = brand.game.fabricVersion
    const jarPath = join(gameDir, 'versions', version, `${version}.jar`)
    const jsonPath = join(gameDir, 'versions', version, `${version}.json`)
    const localManifest = readManagedClientModpack(gameDir)
    const installedLoaderVersion = localManifest?.fabricLoaderVersion ?? loaderVersion
    const hasInstalledFabric = hasFabricLoaderProfile(gameDir, version, installedLoaderVersion)
    
    const managedFilesValid = localManifest?.files?.length
      ? (await Promise.all(localManifest.files.map(file => isValidExistingFile({
          url: '',
          destPath: join(gameDir, 'mods', file.filename!),
          size: file.size,
          sha1: file.sha1,
          sha512: file.sha512,
          label: file.filename!
        }, true)))).every(Boolean)
      : false

    const managedRpValid = localManifest?.resourcePacks?.length
      ? (await Promise.all(localManifest.resourcePacks.map(rp => isValidExistingFile({
          url: '',
          destPath: join(gameDir, 'resourcepacks', rp.filename!),
          size: rp.size,
          sha1: rp.sha1,
          sha512: rp.sha512,
          label: rp.filename!
        }, true)))).every(Boolean)
      : true

    const companionPath = join(gameDir, 'mods', 'heart-identity-fabric.jar')
    const companionExists = existsSync(companionPath)
    const installed = existsSync(jarPath) && existsSync(jsonPath) && hasInstalledFabric && Boolean(localManifest) && managedFilesValid && managedRpValid && companionExists
    const installedVersion = installed ? localManifest?.packVersion ?? getFabricVersionId(version, installedLoaderVersion) : null

    let latestVersion = `${version}-fabric.${loaderVersion}`
    const latestFilesCount = (localManifest?.files?.length ?? 0) + (localManifest?.resourcePacks?.length ?? 0)
    const latestModLabels: string[] = localManifest?.files?.length
      ? localManifest.files.map(file => `${file.filename ?? 'Mod'} — установлено`)
      : CLIENT_MODPACK.map(item => item.name)

    if (Date.now() - this.lastModpackCheckTime > 300_000) {
      try {
        const latestPack = await this.resolveActiveModpack()
        latestVersion = createClientPackVersion(version, loaderVersion, latestPack.files)
      } catch {
        if (this.options.heartBridgeApiBaseUrl?.trim()) latestVersion = localManifest?.packVersion ?? 'bridge-unavailable'
      }
    } else if (localManifest?.packVersion) {
      latestVersion = localManifest.packVersion
    }

    return {
      installedVersion,
      latestVersion,
      installed,
      lastVerified: installed ? localManifest?.installedAt ?? null : null,
      updateSize: installed && installedVersion === latestVersion ? 'актуальная сборка' : `${latestFilesCount} модов и паков`,
      minecraftVersion: version,
      fabricLoaderVersion: loaderVersion,
      javaMajorVersion: brand.game.javaMajorVersion,
      changes: {
        added: [`Fabric Loader ${loaderVersion}`, ...latestModLabels],
        updated: ['Проверка новых релизов модов и ресурс-паков'],
        removed: ['Серверные утилиты исключены из клиента'],
        configurations: ['Minecraft Java 1.21.11', 'Fabric', 'Клиентский профиль']
      }
    }
  }

  async install(): Promise<void> {
    await this.downloadAndInstall()
  }

  async update(): Promise<void> {
    await this.downloadAndInstall()
  }

  async verifyFiles(): Promise<void> {
    await this.downloadAndInstall()
  }

  private async downloadAndInstall(): Promise<void> {
    if (this.status.state === 'running' || this.activeProcess) {
      throw new Error('Игра уже запущена!')
    }

    const version = brand.game.minecraftVersion
    const loaderVersion = brand.game.fabricVersion
    const fabricId = getFabricVersionId(version, loaderVersion)
    const gameDir = await this.getGameDir()
    const operationId = `op-${Date.now()}`
    this.abortController = new AbortController()

    this.emitLog('INFO', `Подготовка сборки Minecraft ${version} + Fabric ${loaderVersion}...`)
    this.setState({ state: 'checking', progress: null, error: null, activeOperationId: operationId })

    try {
      const vanillaJson = await resolveVersionJson(version, gameDir)
      const fabricJson = await resolveFabricVersionJson(version, loaderVersion, gameDir, this.abortController.signal)
      const versionJson = mergeFabricProfile(vanillaJson, fabricJson)

      if (!vanillaJson.downloads?.client || !vanillaJson.assetIndex) {
        throw new Error('Манифест Mojang не содержит клиентский JAR или asset index.')
      }

      const tasks: DownloadTask[] = []
      const clientJarPath = join(gameDir, 'versions', version, `${version}.jar`)
      tasks.push({
        url: vanillaJson.downloads.client.url,
        destPath: clientJarPath,
        size: vanillaJson.downloads.client.size,
        sha1: vanillaJson.downloads.client.sha1,
        label: `${version}.jar`
      })

      const libraryPaths = new Set<string>()
      const nativeArchives: Array<{ path: string; excludes: string[] }> = []
      const nativeOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
      const nativeArch = process.arch === 'ia32' ? '32' : process.arch === 'arm64' ? 'arm64' : '64'

      for (const lib of versionJson.libraries) {
        if (!isRuleAllowed(lib.rules)) continue
        const artifact = lib.downloads?.artifact
        if (artifact && !libraryPaths.has(artifact.path)) {
          libraryPaths.add(artifact.path)
          tasks.push({
            url: artifact.url,
            destPath: join(gameDir, 'libraries', artifact.path),
            size: artifact.size,
            sha1: artifact.sha1,
            label: lib.name
          })
        } else if (!artifact) {
          const maven = getMavenArtifact(lib)
          if (maven && !libraryPaths.has(maven.path)) {
            libraryPaths.add(maven.path)
            tasks.push({
              url: maven.url,
              destPath: join(gameDir, 'libraries', maven.path),
              size: lib.size,
              sha1: lib.sha1,
              label: lib.name
            })
          }
        }

        const classifierName = lib.natives?.[nativeOs]?.replace('${arch}', nativeArch)
        const nativeArtifact = classifierName ? lib.downloads?.classifiers?.[classifierName] : undefined
        if (nativeArtifact && !libraryPaths.has(nativeArtifact.path)) {
          libraryPaths.add(nativeArtifact.path)
          const nativePath = join(gameDir, 'libraries', nativeArtifact.path)
          tasks.push({
            url: nativeArtifact.url,
            destPath: nativePath,
            size: nativeArtifact.size,
            sha1: nativeArtifact.sha1,
            label: `${lib.name} (${nativeOs} natives)`
          })
          nativeArchives.push({ path: nativePath, excludes: lib.extract?.exclude ?? [] })
        }
      }

      const assetIndex = vanillaJson.assetIndex
      const assetIndexDir = join(gameDir, 'assets', 'indexes')
      const assetIndexPath = join(assetIndexDir, `${assetIndex.id}.json`)
      type AssetIndexData = { objects: Record<string, { hash: string; size: number }> }
      let indexData: AssetIndexData | null = null
      if (existsSync(assetIndexPath)) {
        try { indexData = JSON.parse(readFileSync(assetIndexPath, 'utf8')) as AssetIndexData } catch {}
      }
      if (!indexData || !indexData.objects) {
        const response = await fetch(assetIndex.url, { signal: this.abortController.signal })
        if (!response.ok) throw new Error(`Не удалось загрузить asset index: HTTP ${response.status}`)
        const jsonText = await response.text()
        indexData = JSON.parse(jsonText) as AssetIndexData
        mkdirSync(assetIndexDir, { recursive: true })
        writeFileSync(assetIndexPath, jsonText, 'utf8')
      }

      for (const [key, obj] of Object.entries(indexData.objects)) {
        const sub = obj.hash.slice(0, 2)
        tasks.push({
          url: `https://resources.download.minecraft.net/${sub}/${obj.hash}`,
          destPath: join(gameDir, 'assets', 'objects', sub, obj.hash),
          size: obj.size,
          sha1: obj.hash,
          label: key
        })
      }

      const activePack = await this.resolveActiveModpack(this.abortController.signal, message => this.emitLog('INFO', message))
      
      const modFiles = activePack.files
      mkdirSync(join(gameDir, 'mods'), { recursive: true })
      for (const mod of modFiles) {
        tasks.push({
          url: mod.url,
          destPath: join(gameDir, 'mods', mod.filename),
          size: mod.size,
          sha1: mod.sha1,
          sha512: mod.sha512,
          label: `Mod: ${mod.projectName}`
        })
      }

      const resourcePackFiles = activePack.resourcePacks ?? []
      if (resourcePackFiles.length > 0) {
        const rpDirectory = join(gameDir, 'resourcepacks')
        mkdirSync(rpDirectory, { recursive: true })
        for (const rp of resourcePackFiles) {
          tasks.push({
            url: rp.downloadUrl,
            destPath: join(rpDirectory, rp.filename),
            size: rp.fileSize,
            sha1: rp.sha1,
            sha512: rp.sha512,
            label: `ResourcePack: ${rp.title}`
          })
        }
      }

      this.setState({ state: 'downloading', progress: null, error: null, activeOperationId: operationId })

      await downloadFilesWithPool(
        tasks,
        14,
        update => {
          const processed = update.processedBytes
          const percent = update.totalBytes > 0
            ? Math.min(100, Math.round((processed / update.totalBytes) * 100))
            : 100
          const stage: ProgressEvent['stage'] = update.phase === 'checking-cache' ? 'files'
            : update.phase === 'complete' ? 'complete' : 'download'
          const progress: ProgressEvent = {
            operationId,
            operation: 'install',
            stage,
            progress: percent,
            downloadedBytes: update.downloadedBytes,
            totalBytes: update.totalBytes,
            processedBytes: update.processedBytes,
            cachedFiles: update.cachedFiles,
            cachedBytes: update.cachedBytes,
            downloadedFiles: update.downloadedFiles,
            totalFiles: update.totalFiles,
            currentFile: update.currentFile,
            downloadSpeed: update.speedBps,
            timestamp: Date.now()
          }
          for (const listener of this.progressListeners) {
            try { listener(progress) } catch {}
          }
          this.setState({ state: update.phase === 'complete' ? 'installing' : 'downloading', progress, error: null, activeOperationId: operationId })
        },
        this.abortController.signal
      )

      const nativesDir = join(gameDir, 'versions', version, 'natives')
      rmSync(nativesDir, { recursive: true, force: true })
      mkdirSync(nativesDir, { recursive: true })
      for (const archive of nativeArchives) {
        await extractZip(archive.path, { dir: nativesDir })
        for (const excluded of archive.excludes) {
          const target = resolve(nativesDir, excluded)
          if (target !== nativesDir && target.startsWith(`${nativesDir}${sep}`)) {
            rmSync(target, { recursive: true, force: true })
          }
        }
      }

      const managedDir = join(gameDir, 'heart-launcher')
      const managedManifestPath = join(managedDir, 'client-mods.json')
      let previousFiles: string[] = []
      let previousResourcePacks: string[] = []
      if (existsSync(managedManifestPath)) {
        try {
          const previous = JSON.parse(readFileSync(managedManifestPath, 'utf8')) as ManagedClientModpackManifest
          previousFiles = (previous.files ?? []).map(file => file.filename ?? '').filter(name => /^[a-zA-Z0-9._+ -]+\.jar$/i.test(name) && !name.includes('..'))
          previousResourcePacks = (previous.resourcePacks ?? []).map(rp => rp.filename ?? '').filter(name => /^[a-zA-Z0-9._+ -]+\.(zip|jar)$/i.test(name) && !name.includes('..'))
        } catch {}
      }

      const currentNames = new Set(modFiles.map(file => file.filename))
      for (const oldName of previousFiles) {
        if (!currentNames.has(oldName)) rmSync(join(gameDir, 'mods', oldName), { force: true })
      }

      const currentRpNames = new Set(resourcePackFiles.map(rp => rp.filename))
      for (const oldRp of previousResourcePacks) {
        if (!currentRpNames.has(oldRp)) {
          rmSync(join(gameDir, 'resourcepacks', oldRp), { force: true })
        }
      }

      mkdirSync(managedDir, { recursive: true })
      writeFileSync(managedManifestPath, JSON.stringify({
        manifestVersion: 1,
        packRevision: activePack.revision,
        source: activePack.source,
        minecraftVersion: version,
        fabricLoaderVersion: loaderVersion,
        packVersion: createClientPackVersion(version, loaderVersion, modFiles),
        installedAt: new Date().toISOString(),
        files: modFiles.map(file => ({
          projectId: file.projectId,
          projectSlug: file.projectSlug,
          projectName: file.projectName,
          versionId: file.versionId,
          versionNumber: file.versionNumber,
          filename: file.filename,
          size: file.size,
          sha1: file.sha1,
          sha512: file.sha512,
          group: file.group
        })),
        resourcePacks: resourcePackFiles.map(rp => ({
          projectId: rp.projectId,
          slug: rp.slug,
          title: rp.title,
          versionId: rp.versionId,
          filename: rp.filename,
          size: rp.fileSize,
          sha1: rp.sha1,
          sha512: rp.sha512
        }))
      }, null, 2), 'utf8')

      await this.ensureCompanionMod(gameDir, this.abortController.signal, true)
      await this.ensureClientConfigs(gameDir, this.abortController.signal, true)

      this.emitLog('INFO', `Клиент готов к запуску! Профиль: ${fabricId}`)
      this.setState({ state: 'ready', progress: null, error: null, activeOperationId: null })
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        this.setState({ state: 'cancelled', progress: null, error: null, activeOperationId: null })
      } else {
        const msg = err instanceof Error ? err.message : 'Ошибка установки'
        this.setState({ state: 'error', progress: null, error: msg, activeOperationId: null })
        throw err
      }
    } finally {
      this.abortController = null
    }
  }

  private async writeLocalSkin(gameDir: string, profile: UserProfile | null) {
    if (!profile || !profile.skinUrl) return
    try {
      const skinDir = join(gameDir, 'config', 'heart-identity')
      mkdirSync(skinDir, { recursive: true })

      let skinBytes: Buffer | null = null
      if (profile.skinUrl.startsWith('data:image')) {
        skinBytes = Buffer.from(profile.skinUrl.split(',')[1], 'base64')
      } else if (profile.skinUrl.startsWith('http')) {
        try {
          const res = await fetch(profile.skinUrl)
          if (res.ok) skinBytes = Buffer.from(await res.arrayBuffer())
        } catch (e) {}
      }

      if (skinBytes) {
        writeFileSync(join(skinDir, 'skin.png'), skinBytes)
        writeFileSync(join(skinDir, 'skin.txt'), profile.skinVariant || 'classic')
        this.emitLog('INFO', 'Локальный скин успешно подготовлен для мода Heart Identity.')
      }
    } catch (err) {
      this.emitLog('WARN', 'Не удалось сохранить локальный скин: ' + err)
    }
  }

  async launch(): Promise<void> {
    if (this.activeProcess || this.status.state === 'running') {
      throw new Error('Игра уже запущена!')
    }

    const settings = await this.options.settingsService.getSettings()
    const gameDir = await this.getGameDir()
    const version = brand.game.minecraftVersion

    this.setLaunchStep('Инициализация Java 21...')

    let javaBinaryPath = ''
    try {
      javaBinaryPath = await ensureJava21(gameDir, settings.javaPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось подготовить Java 21'
      this.emitLog('ERROR', msg)
      this.setState({ state: 'error', progress: null, error: msg })
      throw new Error(msg)
    }

    const clientJar = join(gameDir, 'versions', version, `${version}.jar`)
    const versionJsonPath = join(gameDir, 'versions', version, `${version}.json`)
    const fabricId = getFabricVersionId(version, brand.game.fabricVersion)
    const fabricJsonPath = join(gameDir, 'versions', fabricId, `${fabricId}.json`)
    const localModpack = readManagedClientModpack(gameDir)
    
    let localModpackIntegrityOk = false
    if (localModpack?.files?.length) {
      const checks = await Promise.all(localModpack.files.map(file => isValidExistingFile({
        url: '',
        destPath: join(gameDir, 'mods', file.filename!),
        size: file.size,
        label: file.filename!
      }, true)))
      localModpackIntegrityOk = checks.every(Boolean)
    }

    let remotePackChanged = false
    const shouldCheckRemote = (Date.now() - this.lastModpackCheckTime > 300_000)
    if (shouldCheckRemote && this.options.heartBridgeApiBaseUrl?.trim()) {
      try {
        const remote = await fetchHeartBridgeModpack(this.options.heartBridgeApiBaseUrl, this.abortController?.signal)
        remotePackChanged = localModpack?.source !== 'HeartBridge' || localModpack.packRevision !== remote.manifest.revision
        this.lastRemoteRevision = remote.manifest.revision
        this.lastModpackCheckTime = Date.now()
      } catch (error) {
        this.emitLog('WARN', `Быстрый запуск: HeartBridge временно недоступен, используем локальную копию.`)
      }
    } else if (this.lastRemoteRevision !== null && localModpack) {
      remotePackChanged = (localModpack.packRevision !== this.lastRemoteRevision)
    }

    const companionPath = join(gameDir, 'mods', 'heart-identity-fabric.jar')
    const modpackReady = Boolean(localModpack) && localModpackIntegrityOk && !remotePackChanged && existsSync(companionPath)

    if (!existsSync(clientJar) || !existsSync(versionJsonPath) || !existsSync(fabricJsonPath) || !modpackReady) {
      this.emitLog('INFO', 'Сборка требует обновления. Загружаю актуальные компоненты...')
      await this.downloadAndInstall()
    }

    const vanillaJson = await resolveVersionJson(version, gameDir)
    const fabricJson = await resolveFabricVersionJson(version, brand.game.fabricVersion, gameDir)
    const versionJson = mergeFabricProfile(vanillaJson, fabricJson)

    const profile = await this.options.getProfile()
    let username = profile?.username && profile.username.trim() ? profile.username.trim() : 'Player'
    let uuid = getOfflinePlayerUuid(username)

    // Сохраняем скин для Companion мода!
    await this.writeLocalSkin(gameDir, profile)
    await this.ensureCompanionMod(gameDir, this.abortController?.signal, false)
    await this.ensureClientConfigs(gameDir, this.abortController?.signal, false)

    ensureServerInServersDat(gameDir, 'Heart', '87.228.56.12:25565')

    const identityDirectory = join(gameDir, 'config', 'heart-identity')
    const grantFilePath = join(identityDirectory, 'minecraft-grant.json')
    rmSync(join(identityDirectory, 'join-ticket.json'), { force: true })

    const grant = await this.options.getMinecraftGrant?.()
    if (grant) {
      username = grant.minecraftUsername
      uuid = grant.minecraftUuid

      mkdirSync(identityDirectory, { recursive: true })
      const serverHost = brand.server.host
      const serverPort = brand.server.port
      const allowedAddresses = Array.from(new Set([
        `${serverHost}:${serverPort}`,
        serverHost,
        'heartserverm.duckdns.org:25565',
        'heartserverm.duckdns.org:27015',
        'heartserverm.duckdns.org',
        '87.228.56.12:25565',
        '87.228.56.12'
      ]))

      const grantPayload = {
        schemaVersion: 1,
        grant: grant.grant,
        username,
        uuid,
        apiBaseUrl: this.options.heartBridgeApiBaseUrl || 'https://heartserverm.duckdns.org:27015',
        allowedServerAddresses: allowedAddresses,
        expiresAt: grant.expiresAt
      }

      const tempGrantPath = join(identityDirectory, `.minecraft-grant-${process.pid}.tmp`)
      writeFileSync(tempGrantPath, JSON.stringify(grantPayload, null, 2), { encoding: 'utf8', mode: 0o600 })
      try { chmodSync(tempGrantPath, 0o600) } catch {}
      renameSync(tempGrantPath, grantFilePath)
    } else {
      rmSync(grantFilePath, { force: true })
    }

    const classpathEntries: string[] = []
    for (const lib of versionJson.libraries) {
      if (!isRuleAllowed(lib.rules)) continue
      if (lib.downloads?.artifact) {
        const fullLibPath = join(gameDir, 'libraries', lib.downloads.artifact.path)
        if (existsSync(fullLibPath)) classpathEntries.push(fullLibPath)
      } else {
        const maven = getMavenArtifact(lib)
        if (maven) {
          const fullLibPath = join(gameDir, 'libraries', maven.path)
          if (existsSync(fullLibPath)) classpathEntries.push(fullLibPath)
        }
      }
    }
    classpathEntries.push(clientJar)

    const sep = process.platform === 'win32' ? ';' : ':'
    const classpath = classpathEntries.join(sep)
    const nativesDir = join(gameDir, 'versions', version, 'natives')
    mkdirSync(nativesDir, { recursive: true })

    const vars: Record<string, string> = {
      natives_directory: nativesDir,
      launcher_name: brand.name,
      launcher_version: brand.version,
      classpath,
      classpath_separator: sep,
      library_directory: join(gameDir, 'libraries'),
      auth_player_name: username,
      version_name: versionJson.id,
      game_directory: gameDir,
      assets_root: join(gameDir, 'assets'),
      assets_index_name: (versionJson.assetIndex ?? vanillaJson.assetIndex)?.id ?? version,
      auth_uuid: uuid,
      auth_access_token: '0',
      clientid: uuid,
      client_id: uuid,
      auth_session: uuid,
      auth_xuid: '0',
      user_type: 'mojang',
      version_type: 'release'
    }

    const replaceVars = (str: string) => str.replace(/\$\{([^}]+)\}/g, (_, k) => vars[k] ?? '')
    const ramGb = Math.max(2, settings.ramGb)
    const initRamGb = Math.max(2, Math.min(3, Math.floor(ramGb / 2)))

    const jvmArgs: string[] = [
      `-Xms${initRamGb}G`,
      `-Xmx${ramGb}G`,
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=60',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=25',
      '-XX:G1MaxNewSizePercent=35',
      '-XX:G1ReservePercent=10',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1',
      '-XX:CICompilerCount=4',
      '-Dsun.rmi.dgc.server.gcInterval=2147483646',
      '-Dsun.rmi.dgc.client.gcInterval=2147483646'
    ]

    if (versionJson.arguments?.jvm) {
      for (const entry of versionJson.arguments.jvm) {
        if (typeof entry === 'string') {
          jvmArgs.push(replaceVars(entry))
        } else if (entry && isRuleAllowed(entry.rules) && entry.value) {
          const vals = Array.isArray(entry.value) ? entry.value : [entry.value]
          for (const v of vals) jvmArgs.push(replaceVars(v))
        }
      }
    } else {
      jvmArgs.push(
        `-Djava.library.path=${nativesDir}`,
        `-Djna.tmpdir=${nativesDir}`,
        `-Dorg.lwjgl.system.SharedLibraryExtractPath=${nativesDir}`,
        `-Dio.netty.native.workdir=${nativesDir}`,
        `-Dminecraft.launcher.brand=${brand.name}`,
        `-Dminecraft.launcher.version=${brand.version}`,
        '-cp',
        classpath
      )
    }

    const gameArgs: string[] = []
    if (versionJson.arguments?.game) {
      for (const entry of versionJson.arguments.game) {
        if (typeof entry === 'string') {
          gameArgs.push(replaceVars(entry))
        } else if (entry && isRuleAllowed(entry.rules) && entry.value) {
          const vals = Array.isArray(entry.value) ? entry.value : [entry.value]
          for (const v of vals) gameArgs.push(replaceVars(v))
        }
      }
    } else if (versionJson.minecraftArguments) {
      for (const part of versionJson.minecraftArguments.split(' ')) {
        gameArgs.push(replaceVars(part))
      }
    }

    const isBorderless = settings.borderless ?? true
    let targetWidth = settings.width || 1920
    let targetHeight = settings.height || 1080

    if (isBorderless) {
      // ВОТ ЭТОТ БЛОК: отключаем эксклюзивный fullscreen в options.txt майна
      try {
        const optionsTxtPath = join(gameDir, 'options.txt')
        if (existsSync(optionsTxtPath)) {
          let content = readFileSync(optionsTxtPath, 'utf8')
          if (content.includes('fullscreen:true')) {
            content = content.replace('fullscreen:true', 'fullscreen:false')
            writeFileSync(optionsTxtPath, content, 'utf8')
          }
        }
      } catch {}

      try {
        const { screen } = await import('electron')
        const primary = screen.getPrimaryDisplay()
        targetWidth = primary.bounds.width
        targetHeight = primary.bounds.height
      } catch {}

      jvmArgs.push('-Dheart.borderless=true')
    }

    if (!gameArgs.includes('--width')) {
      gameArgs.push('--width', String(targetWidth), '--height', String(targetHeight))
    }

    if (isBorderless) {
      const fsIndex = gameArgs.indexOf('--fullscreen')
      if (fsIndex !== -1) gameArgs.splice(fsIndex, 1)
    } else if (settings.fullscreen && !gameArgs.includes('--fullscreen')) {
      gameArgs.push('--fullscreen')
    }

    if (settings.autoConnectServer) {
      const address = this.options.minecraftServerAddress ?? `${brand.server.host}:${brand.server.port}`
      const separator = address.lastIndexOf(':')
      const addressHost = separator > 0 && /^\d+$/.test(address.slice(separator + 1))
        ? address.slice(0, separator)
        : address
      const addressPort = separator > 0 && /^\d+$/.test(address.slice(separator + 1))
        ? address.slice(separator + 1)
        : String(brand.server.port)
      const normalizedHost = addressHost.startsWith('[') && addressHost.endsWith(']')
        ? addressHost.slice(1, -1)
        : addressHost

      gameArgs.push('--quickPlayMultiplayer', `${normalizedHost}:${addressPort}`)
      this.emitLog('INFO', `Включен прямой вход на сервер: ${normalizedHost}:${addressPort}`)
    }

    const fullArgs = [...jvmArgs, versionJson.mainClass, ...gameArgs]
    this.emitLog('INFO', `Запуск JVM Java 21 (Куча: ${ramGb}G)...`)

    const child = spawn(javaBinaryPath, fullArgs, {
      cwd: gameDir,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.activeProcess = child
    this.setLaunchStep('Запуск JVM...')

    let windowDetected = false
    const markWindowReady = () => {
      if (!windowDetected) {
        windowDetected = true
        this.emitLog('INFO', 'Окно Minecraft активно!')
        this.setState({ state: 'running', progress: null, error: null })
        if (settings.closeOnLaunch) {
          if (typeof this.options.onWindowHideRequest === 'function') {
            this.options.onWindowHideRequest()
          } else {
            this.options.onWindowMinimizeRequest?.()
          }
        }
      }
    }

    const safetyTimer = setTimeout(() => markWindowReady(), 45000)

    for (const listener of this.processListeners) {
      try { listener({ type: 'started', timestamp: Date.now(), pid: child.pid }) } catch {}
    }

    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        this.emitLog('INFO', line, 'game')

        if (line.includes('Backend library: LWJGL')) {
          this.setLaunchStep('Инициализация графики...')
        } else if (line.includes('Reloading ResourceManager') || line.includes('OpenAL initialized')) {
          this.setLaunchStep('Загрузка мира и ресурсов...')
        } else if (
          line.includes('Sound engine started') ||
          line.includes('Narrator library successfully initialized') ||
          line.includes('Starting integrated minecraft server')
        ) {
          clearTimeout(safetyTimer)
          markWindowReady()
        }
      }
    })

    child.stderr.on('data', chunk => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) this.emitLog('WARN', line, 'game')
      }
    })

    child.on('close', code => {
      clearTimeout(safetyTimer)
      this.emitLog('INFO', `Игра закрылась (код: ${code})`)
      this.activeProcess = null
      this.setState({ state: 'ready', progress: null, error: null })

      for (const listener of this.processListeners) {
        try { listener({ type: 'exited', timestamp: Date.now(), exitCode: code }) } catch {}
      }

      if (settings.closeOnLaunch) {
        this.options.onWindowRestoreRequest?.()
      }
    })

    child.on('error', err => {
      clearTimeout(safetyTimer)
      this.emitLog('ERROR', `Сбой запуска: ${err.message}`)
      this.activeProcess = null
      this.setState({ state: 'error', progress: null, error: err.message })
    })
  }

  async cancel(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  onProgress(callback: (event: ProgressEvent) => void): () => void {
    this.progressListeners.add(callback)
    return () => this.progressListeners.delete(callback)
  }

  onLog(callback: (event: GameLogEvent) => void): () => void {
    this.logListeners.add(callback)
    return () => this.logListeners.delete(callback)
  }

  onStateChange(callback: (state: LauncherStatus) => void): () => void {
    this.stateListeners.add(callback)
    return () => this.stateListeners.delete(callback)
  }

  onGameProcess(callback: (event: GameProcessEvent) => void): () => void {
    this.processListeners.add(callback)
    return () => this.processListeners.delete(callback)
  }
}