import { describe, expect, it } from 'vitest'
import { createMinecraftStatusService } from '../src/main/services/minecraft-status-service'

describe('Minecraft status service configuration', () => {
  it('rejects an invalid port', () => {
    expect(() => createMinecraftStatusService({ host: '127.0.0.1', port: 70000 })).toThrow('Некорректный адрес Minecraft-сервера')
  })
  it('rejects an empty host', () => {
    expect(() => createMinecraftStatusService({ host: ' ', port: 25565 })).toThrow('Некорректный адрес Minecraft-сервера')
  })
})
