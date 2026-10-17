// Pictures for kids mode: image files in ~/.cockpit/kids/, sent to the chrome
// as data: URLs, which the chrome's CSP allows for images.
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KidsCharacter } from '@shared/ipc'

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_FILES = 100

/** "peppa_pig" and "Peppa-Pig" both read as "Peppa Pig". */
function displayName(file: string): string {
  return path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Images in `dir`, sorted by name. Symlinks are followed. Files over the size
 * limit, past the count limit, or past the total limit are skipped. A missing
 * directory is created, so there's somewhere to drop pictures.
 */
export async function listCharacters(dir: string): Promise<KidsCharacter[]> {
  await fs.mkdir(dir, { recursive: true })
  const names = (await fs.readdir(dir))
    .filter((n) => !n.startsWith('.') && TYPES[path.extname(n).toLowerCase()])
    .sort((a, b) => a.localeCompare(b))
  const out: KidsCharacter[] = []
  let total = 0
  for (const file of names) {
    if (out.length >= MAX_FILES) break
    const type = TYPES[path.extname(file).toLowerCase()]
    const name = displayName(file)
    if (!type || !name) continue
    let data: Buffer
    try {
      const st = await fs.stat(path.join(dir, file))
      if (!st.isFile() || st.size > MAX_FILE_BYTES || total + st.size > MAX_TOTAL_BYTES) continue
      data = await fs.readFile(path.join(dir, file))
    } catch {
      continue
    }
    total += data.length
    const first = name[0]?.toLowerCase() ?? ''
    out.push({
      name,
      letter: /^[a-z]$/.test(first) ? first : null,
      src: `data:${type};base64,${data.toString('base64')}`
    })
  }
  return out
}
