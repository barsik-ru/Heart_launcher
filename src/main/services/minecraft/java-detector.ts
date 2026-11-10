import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface JavaInfo {
  path: string
  version: string
  majorVersion: number
}

export function verifyJavaBinary(binaryPath: string): JavaInfo | null {
  try {
    if (!existsSync(binaryPath)) return null
    const result = spawnSync(binaryPath, ['-version'], { encoding: 'utf8', timeout: 4000 })
    const output = (result.stderr || '') + (result.stdout || '')
    const match = output.match(/version\s+"(\d+)(?:\.(\d+))?/)
    if (!match) return null

    const majorVersion = parseInt(match[1], 10)
    return {
      path: binaryPath,
      version: match[0].replace('version ', '').replace(/"/g, ''),
      majorVersion
    }
  } catch {
    return null
  }
}

export function findJava21(customPath?: string): JavaInfo | null {
  if (customPath && customPath.trim()) {
    const verified = verifyJavaBinary(customPath.trim())
    if (verified && verified.majorVersion >= 21) return verified
  }

  const isWindows = process.platform === 'win32'
  const binaryName = isWindows ? 'javaw.exe' : 'java'
  const fallbackBinary = isWindows ? 'java.exe' : 'java'

  const javaHome = process.env.JAVA_HOME
  if (javaHome) {
    const candidates = [
      join(javaHome, 'bin', binaryName),
      join(javaHome, 'bin', fallbackBinary)
    ]
    for (const c of candidates) {
      const verified = verifyJavaBinary(c)
      if (verified && verified.majorVersion >= 21) return verified
    }
  }

  if (isWindows) {
    const searchRoots = [
      process.env['ProgramFiles'] || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA']!, 'Programs') : ''
    ].filter(Boolean)

    const vendors = ['Eclipse Adoptium', 'Java', 'Microsoft', 'BellSoft', 'Amazon Corretto', 'Zulu']

    for (const root of searchRoots) {
      for (const vendor of vendors) {
        const vendorDir = join(root, vendor)
        if (!existsSync(vendorDir)) continue
        try {
          const entries = readdirSync(vendorDir, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const binCandidates = [
              join(vendorDir, entry.name, 'bin', 'javaw.exe'),
              join(vendorDir, entry.name, 'bin', 'java.exe')
            ]
            for (const cand of binCandidates) {
              const verified = verifyJavaBinary(cand)
              if (verified && verified.majorVersion >= 21) return verified
            }
          }
        } catch {}
      }
    }

    const mcRuntimes = [
      join(process.env['LOCALAPPDATA'] || '', 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime', 'java-runtime-delta', 'windows-x64', 'java-runtime-delta', 'bin', 'javaw.exe'),
      join(process.env['APPDATA'] || '', '.minecraft', 'runtime', 'java-runtime-delta', 'windows-x64', 'java-runtime-delta', 'bin', 'javaw.exe')
    ]
    for (const rt of mcRuntimes) {
      const v = verifyJavaBinary(rt)
      if (v && v.majorVersion >= 21) return v
    }
  }

  const fromPath = verifyJavaBinary(binaryName) || verifyJavaBinary(fallbackBinary)
  if (fromPath && fromPath.majorVersion >= 21) return fromPath

  return null
}