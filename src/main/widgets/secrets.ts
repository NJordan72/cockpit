// cockpit.secrets: values encrypted with Electron's safeStorage (the key lives
// in the macOS Keychain), one file per widget and name under
// ~/.cockpit/secrets/<widget id>/<name>.bin. Widgets only ever see secrets
// they declare, and each widget has its own namespace.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import { WidgetCallError } from './errors'

export const MAX_SECRET_LENGTH = 64 * 1024

export class SecretStore {
  constructor(readonly dir: string) {}

  async get(widgetId: string, name: string): Promise<string | null> {
    let blob: Buffer
    try {
      blob = await fs.readFile(this.file(widgetId, name))
    } catch {
      return null
    }
    await this.ensureAvailable()
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(blob)
      if (shouldReEncrypt) await this.set(widgetId, name, result)
      return result
    } catch (err) {
      // Encrypted with a key we no longer have (the Keychain item was reset).
      // Treat it as missing so the user is asked again.
      console.warn(`secret ${widgetId}/${name} could not be decrypted:`, err)
      return null
    }
  }

  async set(widgetId: string, name: string, value: string): Promise<void> {
    await this.ensureAvailable()
    const blob = await safeStorage.encryptStringAsync(value)
    const dir = path.join(this.dir, widgetId)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const file = this.file(widgetId, name)
    // Unique, so two writes of the same secret can't rename each other's file away.
    const tmp = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(tmp, blob, { mode: 0o600 })
    await fs.rename(tmp, file)
  }

  async delete(widgetId: string, name: string): Promise<void> {
    await fs.rm(this.file(widgetId, name), { force: true })
  }

  private file(widgetId: string, name: string): string {
    // Both are validated against strict patterns before they get here.
    return path.join(this.dir, widgetId, `${name}.bin`)
  }

  private async ensureAvailable(): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new WidgetCallError(
        'unavailable',
        'secret storage is unavailable (safeStorage could not reach the Keychain)'
      )
    }
  }
}
