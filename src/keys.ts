import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { GeminiClient, KeyPool } from '@kevinsisi/ai-core'
import type { ApiKey, StorageAdapter } from '@kevinsisi/ai-core'
import type { AutopilotConfig, KeyImportSummary, KeyStatusSummary } from './types.js'

const KEY_STORE_VERSION = 1
const GEMINI_KEY_RE = /^AIzaSy[0-9A-Za-z_-]{30,40}$/
const PLACEHOLDER_RE = /^(your[_-]?key[_-]?here|xxx+|test|example|changeme)$/i
let keyStoreQueue = Promise.resolve()

interface PersistedKeyStore {
  version: number
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
      currentStore.version = store.version
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
    store.version = KEY_STORE_VERSION
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
  try {
    const parsed = JSON.parse(await readFile(keyStorePath(config), 'utf8')) as Partial<PersistedKeyStore>
    if (!Array.isArray(parsed.keys)) return emptyKeyStore()
    return {
      version: KEY_STORE_VERSION,
      nextId: typeof parsed.nextId === 'number' && parsed.nextId > 0 ? parsed.nextId : nextIdFromKeys(parsed.keys),
      keys: parsed.keys.filter(isApiKey),
    }
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return emptyKeyStore()
    throw error
  }
}

async function writeKeyStore(config: AutopilotConfig, store: PersistedKeyStore): Promise<void> {
  const path = keyStorePath(config)
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(tempPath, path)
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
  return { version: KEY_STORE_VERSION, nextId: 1, keys: [] }
}

function nextIdFromKeys(keys: ApiKey[]): number {
  return Math.max(0, ...keys.map((key) => key.id).filter((id) => Number.isInteger(id))) + 1
}

function isApiKey(value: unknown): value is ApiKey {
  const key = value as Partial<ApiKey>
  return typeof key.id === 'number' && typeof key.key === 'string' && GEMINI_KEY_RE.test(key.key)
}

function keyStorePath(config: AutopilotConfig): string {
  return join(config.dataDir, 'keys.json')
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
