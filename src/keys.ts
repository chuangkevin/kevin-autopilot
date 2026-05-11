import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { GeminiClient, KeyPool } from '@kevinsisi/ai-core'
import type { ApiKey, StorageAdapter } from '@kevinsisi/ai-core'
import type { AutopilotConfig, KeyImportSummary, KeyStatusSummary } from './types.js'

const GEMINI_KEY_RE = /^AIzaSy[0-9A-Za-z_-]{30,40}$/
const PLACEHOLDER_RE = /^(your[_-]?key[_-]?here|xxx+|test|example|changeme)$/i
let keyStoreQueue = Promise.resolve()
let migratedLegacyStores = new Set<string>()

interface PersistedKeyStore {
  nextId: number
  keys: ApiKey[]
}

class SingleKeyStorageAdapter implements StorageAdapter {
  private readonly keys: ApiKey[]

  constructor(key: string) {
    this.keys = [makeApiKey(1, key)]
  }

  async getKeys(): Promise<ApiKey[]> {
    return this.keys.map((key) => ({ ...key }))
  }

  async acquireLease(keyId: number, leaseUntil: number, leaseToken: string, now: number): Promise<boolean> {
    return updateTransientKey(this.keys, keyId, (key) => {
      if (!key.isActive || key.cooldownUntil > now || key.leaseUntil > now) return false
      key.leaseUntil = leaseUntil
      key.leaseToken = leaseToken
      return true
    })
  }

  async renewLease(keyId: number, leaseUntil: number, leaseToken: string): Promise<boolean> {
    return updateTransientKey(this.keys, keyId, (key) => {
      if (key.leaseToken !== leaseToken) return false
      key.leaseUntil = leaseUntil
      return true
    })
  }

  async updateKey(updatedKey: ApiKey, expectedLeaseToken?: string | null): Promise<void> {
    const index = this.keys.findIndex((key) => key.id === updatedKey.id)
    if (index < 0) return
    if (expectedLeaseToken !== undefined && this.keys[index]?.leaseToken !== expectedLeaseToken) return
    this.keys[index] = { ...updatedKey }
  }
}

export class FileKeyStorageAdapter implements StorageAdapter {
  private readonly envKeys = getEnvGeminiKeys().map((key, index) => makeApiKey(-index - 1, key))

  constructor(private readonly config: AutopilotConfig) {}

  async getKeys(): Promise<ApiKey[]> {
    const store = await readKeyStore(this.config)
    return [...store.keys.map((key) => ({ ...key })), ...this.envKeys.map((key) => ({ ...key }))]
  }

  async acquireLease(keyId: number, leaseUntil: number, leaseToken: string, now: number): Promise<boolean> {
    if (keyId < 0) {
      return updateTransientKey(this.envKeys, keyId, (key) => {
        if (!key.isActive || key.cooldownUntil > now || key.leaseUntil > now) return false
        key.leaseUntil = leaseUntil
        key.leaseToken = leaseToken
        return true
      })
    }

    return updateLeasedKey(this.config, keyId, (key) => {
      if (!key.isActive || key.cooldownUntil > now || key.leaseUntil > now) return false
      key.leaseUntil = leaseUntil
      key.leaseToken = leaseToken
      return true
    })
  }

  async renewLease(keyId: number, leaseUntil: number, leaseToken: string): Promise<boolean> {
    if (keyId < 0) {
      return updateTransientKey(this.envKeys, keyId, (key) => {
        if (key.leaseToken !== leaseToken) return false
        key.leaseUntil = leaseUntil
        return true
      })
    }

    return updateLeasedKey(this.config, keyId, (key) => {
      if (key.leaseToken !== leaseToken) return false
      key.leaseUntil = leaseUntil
      return true
    })
  }

  async updateKey(updatedKey: ApiKey, expectedLeaseToken?: string | null): Promise<void> {
    const envIndex = this.envKeys.findIndex((key) => key.id === updatedKey.id)
    if (envIndex >= 0) {
      if (expectedLeaseToken !== undefined && this.envKeys[envIndex]?.leaseToken !== expectedLeaseToken) return
      this.envKeys[envIndex] = { ...updatedKey }
      return
    }

    await transactKeyStore(this.config, async (store) => {
      const index = store.keys.findIndex((key) => key.id === updatedKey.id)
      if (index < 0) return false
      if (expectedLeaseToken !== undefined && store.keys[index]?.leaseToken !== expectedLeaseToken) return false
      store.keys[index] = { ...updatedKey }
      return true
    })
  }
}

export function parseGeminiKeys(rawText: string): string[] {
  const seen = new Set<string>()
  const keys: string[] = []

  for (const rawPart of rawText.split(/[\r\n,]+/)) {
    const value = normalizeKeyInput(rawPart)
    if (!value || seen.has(value) || PLACEHOLDER_RE.test(value) || !GEMINI_KEY_RE.test(value)) continue
    seen.add(value)
    keys.push(value)
  }

  return keys
}

export async function importGeminiKeys(
  config: AutopilotConfig,
  rawText: string,
  replace = false,
): Promise<KeyImportSummary> {
  const submittedCount = countSubmittedKeys(rawText)
  const incomingKeys = parseGeminiKeys(rawText)
  const validIncomingKeys = await validateImportedKeys(config, incomingKeys)
  const imported = await transactKeyStore(config, async (currentStore) => {
    const store = replace ? emptyKeyStore() : currentStore
    const existing = new Set(store.keys.map((key) => key.key))
    const importedKeys: ApiKey[] = []

    for (const key of validIncomingKeys) {
      if (existing.has(key)) continue
      const apiKey = makeApiKey(store.nextId++, key)
      store.keys.push(apiKey)
      importedKeys.push(apiKey)
      existing.add(key)
    }

    if (replace) {
      currentStore.nextId = store.nextId
      currentStore.keys = store.keys
    }
    return importedKeys
  })
  const status = await getKeyStatus(config)
  return {
    imported: imported.length,
    ignored: Math.max(0, submittedCount - imported.length),
    totalStored: status.storedCount,
    replace,
    status,
  }
}

async function validateImportedKeys(config: AutopilotConfig, keys: string[]): Promise<string[]> {
  if (!config.ai?.enabled || config.ai.validateImportedKeys === false) return keys
  const validKeys: string[] = []
  for (const key of keys) {
    if (await validateGeminiKey(config, key)) validKeys.push(key)
  }
  return validKeys
}

async function validateGeminiKey(config: AutopilotConfig, key: string): Promise<boolean> {
  if (!config.ai) return true
  const client = new GeminiClient(new KeyPool(new SingleKeyStorageAdapter(key)), { maxRetries: 0 })
  try {
    await withTimeout(
      client.generateContent({
        model: config.ai.model,
        maxOutputTokens: 1,
        systemInstruction: 'Return a minimal validation response.',
        prompt: 'Reply OK.',
      }),
      config.ai.timeoutMs ?? 20_000,
    )
    return true
  } catch {
    return false
  }
}

export async function clearStoredGeminiKeys(config: AutopilotConfig): Promise<KeyStatusSummary> {
  await transactKeyStore(config, (store) => {
    store.nextId = 1
    store.keys = []
    return true
  })
  return getKeyStatus(config)
}

export async function getKeyStatus(config: AutopilotConfig): Promise<KeyStatusSummary> {
  const store = await readKeyStore(config)
  const envKeys = getEnvGeminiKeys()
  return {
    storedCount: store.keys.length,
    envCount: envKeys.length,
    totalAvailable: store.keys.length + envKeys.length,
    storedSuffixes: store.keys.map((key) => maskKeySuffix(key.key)),
    envSuffixes: envKeys.map(maskKeySuffix),
  }
}

export async function hasGeminiKeys(config: AutopilotConfig): Promise<boolean> {
  const status = await getKeyStatus(config)
  return status.totalAvailable > 0
}

function normalizeKeyInput(rawPart: string): string {
  let value = rawPart.trim()
  if (!value) return ''
  value = value.replace(/^export\s+/i, '').trim()
  const equalsIndex = value.indexOf('=')
  if (equalsIndex >= 0) value = value.slice(equalsIndex + 1).trim()
  return value.replace(/^['"]|['"]$/g, '').trim()
}

function countSubmittedKeys(rawText: string): number {
  return rawText.split(/[\r\n,]+/).map(normalizeKeyInput).filter(Boolean).length
}

function getEnvGeminiKeys(): string[] {
  return [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]
    .filter((key): key is string => Boolean(key && key.trim().length > 0))
    .map((key) => key.trim())
    .filter((key) => GEMINI_KEY_RE.test(key))
}

async function readKeyStore(config: AutopilotConfig): Promise<PersistedKeyStore> {
  await migrateLegacyKeyStore(config)
  const db = openKeyDatabase(config)
  try {
    const rows = db.prepare('SELECT id, key, is_active, cooldown_until, lease_until, lease_token, usage_count FROM gemini_keys ORDER BY id').all()
    const keys = rows.map(rowToApiKey).filter(isApiKey)
    return { nextId: nextIdFromKeys(keys), keys }
  } finally {
    db.close()
  }
}

async function writeKeyStore(config: AutopilotConfig, store: PersistedKeyStore): Promise<void> {
  await mkdir(dirname(keyDatabasePath(config)), { recursive: true })
  const db = openKeyDatabase(config)
  try {
    db.exec('BEGIN IMMEDIATE')
    db.exec('DELETE FROM gemini_keys')
    const insert = db.prepare(`
      INSERT INTO gemini_keys (id, key, is_active, cooldown_until, lease_until, lease_token, usage_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const key of store.keys) {
      insert.run(key.id, key.key, key.isActive ? 1 : 0, key.cooldownUntil, key.leaseUntil, key.leaseToken, key.usageCount)
    }
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {}
    throw error
  } finally {
    db.close()
  }
}

async function updateLeasedKey(
  config: AutopilotConfig,
  keyId: number,
  updater: (key: ApiKey) => boolean,
): Promise<boolean> {
  return transactKeyStore(config, (store) => {
    const key = store.keys.find((item) => item.id === keyId)
    if (!key) return false
    return updater(key)
  })
}

async function transactKeyStore<T>(
  config: AutopilotConfig,
  updater: (store: PersistedKeyStore) => T | Promise<T>,
): Promise<T> {
  const transaction = keyStoreQueue.then(async () => {
    const store = await readKeyStore(config)
    const result = await updater(store)
    await writeKeyStore(config, store)
    return result
  })
  keyStoreQueue = transaction.then(
    () => undefined,
    () => undefined,
  )
  return transaction
}

function updateTransientKey(keys: ApiKey[], keyId: number, updater: (key: ApiKey) => boolean): boolean {
  const key = keys.find((item) => item.id === keyId)
  if (!key) return false
  return updater(key)
}

function makeApiKey(id: number, key: string): ApiKey {
  return {
    id,
    key,
    isActive: true,
    cooldownUntil: 0,
    leaseUntil: 0,
    leaseToken: null,
    usageCount: 0,
  }
}

function emptyKeyStore(): PersistedKeyStore {
  return { nextId: 1, keys: [] }
}

function nextIdFromKeys(keys: ApiKey[]): number {
  return nextIdFromIds(keys.map((key) => key.id))
}

function nextIdFromIds(ids: number[]): number {
  return Math.max(0, ...ids.filter((id) => Number.isInteger(id))) + 1
}

function isApiKey(value: unknown): value is ApiKey {
  const key = value as Partial<ApiKey>
  return typeof key.id === 'number' && typeof key.key === 'string' && GEMINI_KEY_RE.test(key.key)
}

function legacyKeyStorePath(config: AutopilotConfig): string {
  return join(config.dataDir, 'keys.json')
}

function keyDatabasePath(config: AutopilotConfig): string {
  return join(config.dataDir, 'autopilot.db')
}

function openKeyDatabase(config: AutopilotConfig): DatabaseSync {
  mkdirSync(dirname(keyDatabasePath(config)), { recursive: true })
  const db = new DatabaseSync(keyDatabasePath(config))
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_keys (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      cooldown_until INTEGER NOT NULL DEFAULT 0,
      lease_until INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  return db
}

async function migrateLegacyKeyStore(config: AutopilotConfig): Promise<void> {
  const legacyPath = legacyKeyStorePath(config)
  if (migratedLegacyStores.has(legacyPath) || !existsSync(legacyPath)) return
  const db = openKeyDatabase(config)
  try {
    const parsed = JSON.parse(readFileSync(legacyPath, 'utf8')) as Partial<{ keys: unknown[] }>
    const keys = Array.isArray(parsed.keys) ? parsed.keys.filter(isApiKey) : []
    const existingKeys = new Set(db.prepare('SELECT key FROM gemini_keys').all().map((row) => String((row as Record<string, unknown>).key)))
    let nextId = nextIdFromIds(db.prepare('SELECT id FROM gemini_keys').all().map((row) => Number((row as Record<string, unknown>).id)))
    const insert = db.prepare(`
      INSERT INTO gemini_keys (id, key, is_active, cooldown_until, lease_until, lease_token, usage_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    db.exec('BEGIN IMMEDIATE')
    for (const key of keys) {
      if (existingKeys.has(key.key)) continue
      insert.run(nextId++, key.key, key.isActive ? 1 : 0, key.cooldownUntil, key.leaseUntil, key.leaseToken, key.usageCount)
      existingKeys.add(key.key)
    }
    db.exec('COMMIT')
    unlinkSync(legacyPath)
    migratedLegacyStores.add(legacyPath)
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {}
    throw error
  } finally {
    db.close()
  }
}

function rowToApiKey(row: unknown): ApiKey {
  const value = row as Record<string, unknown>
  return {
    id: Number(value.id),
    key: String(value.key),
    isActive: Boolean(value.is_active),
    cooldownUntil: Number(value.cooldown_until),
    leaseUntil: Number(value.lease_until),
    leaseToken: typeof value.lease_token === 'string' ? value.lease_token : null,
    usageCount: Number(value.usage_count),
  }
}

function maskKeySuffix(key: string): string {
  return `...${key.slice(-4)}`
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Gemini key validation timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
