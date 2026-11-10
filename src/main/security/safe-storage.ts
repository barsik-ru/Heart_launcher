import { safeStorage } from 'electron'

export interface SecretStorage {
  isAvailable(): boolean
  encrypt(value: string): string | null
  decrypt(value: string): string | null
}

export const secretStorage: SecretStorage = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: value => {
    try {
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(value).toString('base64')
        : null
    } catch {
      return null
    }
  },
  decrypt: value => {
    try {
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(value, 'base64'))
        : null
    } catch {
      return null
    }
  }
}
