// Reads widget.json. Anything malformed is an error with a message that says
// which field is wrong, shown in the widget's panel instead of the widget.
import type { WidgetManifest, WidgetPermissions } from '@shared/widgets'
import { parseHostPattern, parseUrlPattern, type HostPattern, type UrlPattern } from './permissions'

export const MANIFEST_FILE = 'widget.json'

/**
 * A widget id is a folder name and a URL host, so it's a lowercase DNS label.
 * It starts with a letter because Chromium rewrites hosts that look like
 * numbers (123, 0x10) as IP addresses, and xn-- labels as punycode.
 */
export const WIDGET_ID = /^(?!xn--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
export const SECRET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export interface ParsedManifest {
  manifest: WidgetManifest
  network: HostPattern[]
  openExternal: UrlPattern[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const PERMISSION_KEYS = new Set(['network', 'openExternal', 'secrets', 'storage', 'sessions'])

function stringList(perms: Obj, key: string): string[] {
  const v = perms[key]
  if (v === undefined) return []
  if (!Array.isArray(v) || !v.every((s): s is string => typeof s === 'string')) {
    throw new Error(`"permissions.${key}" must be a list of strings`)
  }
  return v
}

function compileEach<T>(key: string, list: string[], parse: (s: string) => T): T[] {
  return list.map((s, i) => {
    try {
      return parse(s)
    } catch (err) {
      throw new Error(`"permissions.${key}[${i}]" (${JSON.stringify(s)}) ${(err as Error).message}`)
    }
  })
}

function validEntry(entry: string): boolean {
  if (entry.startsWith('/') || entry.includes('\\')) return false
  const parts = entry.split('/')
  return parts.every((p) => p !== '' && p !== '.' && p !== '..') && /\.html?$/i.test(entry)
}

/** Throws an Error describing the first problem found. */
export function parseManifest(raw: unknown, folder: string): ParsedManifest {
  if (!isObj(raw)) throw new Error(`${MANIFEST_FILE} must contain a JSON object`)

  if (typeof raw.id !== 'string' || !WIDGET_ID.test(raw.id)) {
    throw new Error('"id" must be lowercase letters, digits, and dashes, starting with a letter')
  }
  if (raw.id !== folder) {
    throw new Error(`"id" is "${raw.id}" but the folder is named "${folder}"; they must match`)
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new Error('"name" must be a non-empty string')
  }
  const entry = raw.entry ?? 'index.html'
  if (typeof entry !== 'string' || !validEntry(entry)) {
    throw new Error('"entry" must be a relative path to an .html file inside the widget folder')
  }
  const sizing = raw.sizing ?? 'fill'
  if (sizing !== 'fill' && sizing !== 'content') {
    throw new Error('"sizing" must be "fill" or "content"')
  }

  const perms = raw.permissions ?? {}
  if (!isObj(perms)) throw new Error('"permissions" must be an object')
  for (const key of Object.keys(perms)) {
    if (!PERMISSION_KEYS.has(key)) {
      throw new Error(`unknown permission "${key}" (known: ${[...PERMISSION_KEYS].join(', ')})`)
    }
  }

  const networkList = stringList(perms, 'network')
  const externalList = stringList(perms, 'openExternal')
  const secrets = stringList(perms, 'secrets')
  secrets.forEach((name, i) => {
    if (!SECRET_NAME.test(name)) {
      throw new Error(
        `"permissions.secrets[${i}]" (${JSON.stringify(name)}) must be letters, digits, ".", "_", or "-"`
      )
    }
  })
  if (perms.storage !== undefined && typeof perms.storage !== 'boolean') {
    throw new Error('"permissions.storage" must be true or false')
  }
  if (perms.sessions !== undefined && perms.sessions !== 'read' && perms.sessions !== false) {
    throw new Error('"permissions.sessions" must be "read" or false')
  }

  const permissions: WidgetPermissions = {
    network: networkList,
    openExternal: externalList,
    secrets: [...new Set(secrets)],
    storage: perms.storage === true,
    sessions: perms.sessions === 'read' ? 'read' : null
  }

  return {
    manifest: {
      id: raw.id,
      name: raw.name.trim(),
      version: typeof raw.version === 'string' ? raw.version : '0.0.0',
      description: typeof raw.description === 'string' ? raw.description : null,
      entry,
      sizing,
      permissions
    },
    network: compileEach('network', networkList, parseHostPattern),
    openExternal: compileEach('openExternal', externalList, parseUrlPattern)
  }
}
