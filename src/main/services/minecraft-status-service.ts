import { Socket, createConnection } from 'node:net'
import type { ServerService } from '../../shared/contracts/services'
import type { ServerStatus } from '../../shared/types'

export interface MinecraftServerAddress { host: string; port: number }

function writeVarInt(value: number): Buffer {
  const bytes: number[] = []
  let remaining = value >>> 0
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining !== 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining !== 0)
  return Buffer.from(bytes)
}

function readVarInt(buffer: Buffer, offset = 0): { value: number; size: number } | null {
  let value = 0
  let size = 0
  let byte: number
  do {
    if (offset + size >= buffer.length || size >= 5) return null
    byte = buffer[offset + size]
    value |= (byte & 0x7f) << (7 * size)
    size += 1
  } while ((byte & 0x80) !== 0)
  return { value: value >>> 0, size }
}

function packet(payload: Buffer): Buffer {
  return Buffer.concat([writeVarInt(payload.length), payload])
}

function statusRequest(address: MinecraftServerAddress): Buffer {
  const host = Buffer.from(address.host, 'utf8')
  const handshake = Buffer.concat([
    writeVarInt(0), writeVarInt(-1), writeVarInt(host.length), host,
    Buffer.from([address.port >> 8, address.port & 0xff]), writeVarInt(1)
  ])
  return Buffer.concat([packet(handshake), packet(writeVarInt(0))])
}

function readStatusResponse(buffer: Buffer): unknown | null {
  const frame = readVarInt(buffer)
  if (!frame) return null
  if (frame.value < 1 || frame.value > 1_000_000) throw new Error('Некорректный пакет статуса Minecraft')
  if (buffer.length < frame.size + frame.value) return null
  const packetData = buffer.subarray(frame.size, frame.size + frame.value)
  const packetId = readVarInt(packetData)
  if (!packetId || packetId.value !== 0) throw new Error('Неожиданный пакет от Minecraft-сервера')
  const jsonLength = readVarInt(packetData, packetId.size)
  if (!jsonLength) return null
  const start = packetId.size + jsonLength.size
  if (start + jsonLength.value > packetData.length) return null
  return JSON.parse(packetData.subarray(start, start + jsonLength.value).toString('utf8')) as unknown
}

function flattenMotd(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const item = value as { text?: unknown; extra?: unknown }
  const own = typeof item.text === 'string' ? item.text : ''
  const extra = Array.isArray(item.extra) ? item.extra.map(flattenMotd).join('') : ''
  return own + extra
}

function queryServer(address: MinecraftServerAddress, timeoutMs: number): Promise<ServerStatus> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    let buffer = Buffer.alloc(0)
    let settled = false
    const socket: Socket = createConnection({ host: address.host, port: address.port })
    const finish = (error?: Error, result?: ServerStatus): void => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else if (result) resolve(result)
      else reject(new Error('Пустой ответ от Minecraft-сервера'))
    }
    socket.setTimeout(timeoutMs, () => finish(new Error('Истекло время ожидания ответа Minecraft-сервера')))
    socket.once('connect', () => socket.write(statusRequest(address)))
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        const raw = readStatusResponse(buffer)
        if (raw === null) return
        if (!raw || typeof raw !== 'object') throw new Error('Некорректный JSON статуса Minecraft')
        const data = raw as {
          version?: { name?: unknown }
          players?: { online?: unknown; max?: unknown }
          description?: unknown
        }
        const online = typeof data.players?.online === 'number' && Number.isFinite(data.players.online) ? data.players.online : 0
        const capacity = typeof data.players?.max === 'number' && Number.isFinite(data.players.max) ? data.players.max : 0
        const version = typeof data.version?.name === 'string' ? data.version.name : 'Неизвестно'
        const message = flattenMotd(data.description).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240)
        finish(undefined, { online: true, players: Math.max(0, online), capacity: Math.max(0, capacity), latency: Date.now() - started, message: [version, message].filter(Boolean).join(' · '), address: `${address.host}:${address.port}`, demo: false })
      } catch (cause) {
        finish(cause instanceof Error ? cause : new Error('Ошибка разбора статуса Minecraft'))
      }
    })
    socket.once('error', error => finish(error))
    socket.once('close', () => { if (!settled) finish(new Error('Соединение с Minecraft-сервером закрыто')) })
  })
}

export function createMinecraftStatusService(address: MinecraftServerAddress, timeoutMs = 3500): ServerService {
  const validated = { host: address.host.trim(), port: address.port }
  if (!validated.host || validated.host.length > 253 || !Number.isInteger(validated.port) || validated.port < 1 || validated.port > 65535) {
    throw new Error('Некорректный адрес Minecraft-сервера')
  }
  let lastStatus: ServerStatus = { online: false, players: 0, capacity: 0, latency: null, message: 'Проверка ещё не выполнялась', address: `${validated.host}:${validated.port}`, demo: false }
  return {
    async getStatus() {
      try {
        lastStatus = await queryServer(validated, timeoutMs)
      } catch (cause) {
        lastStatus = { online: false, players: 0, capacity: 0, latency: null, message: cause instanceof Error ? cause.message : 'Сервер недоступен', address: `${validated.host}:${validated.port}`, demo: false }
      }
      return { ...lastStatus }
    },
    async getOnlinePlayers() {
      const status = await this.getStatus()
      return status.online ? status.players : 0
    }
  }
}
