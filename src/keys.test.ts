import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearStoredGeminiKeys, FileKeyStorageAdapter, getKeyStatus, importGeminiKeys, parseGeminiKeys } from './keys.js'
import type { AutopilotConfig } from './types.js'

const KEY_ONE = `AIzaSy${'A'.repeat(33)}`
const KEY_TWO = `AIzaSy${'B'.repeat(33)}`

test('parseGeminiKeys accepts common paste formats and deduplicates', () => {
  assert.deepEqual(
    parseGeminiKeys(`GEMINI_API_KEY=${KEY_ONE}\nexport GOOGLE_API_KEY='${KEY_TWO}'\n${KEY_ONE}\nnot-a-key`),
    [KEY_ONE, KEY_TWO],
  )
})

test('importGeminiKeys stores keys without exposing full values in status', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-keys-'))
  const config = makeConfig(dataDir)
  try {
    const summary = await importGeminiKeys(config, `${KEY_ONE}, ${KEY_TWO}, invalid`, false)
    assert.equal(summary.imported, 2)
    assert.equal(summary.ignored, 1)
    assert.deepEqual(summary.status.storedSuffixes, ['...AAAA', '...BBBB'])

    const status = await getKeyStatus(config)
    assert.equal(status.storedCount, 2)
    assert.equal(status.totalAvailable, 2)
    assert.ok(!JSON.stringify(status).includes(KEY_ONE))

    const rawStore = await readFile(join(dataDir, 'keys.json'), 'utf8')
    assert.ok(rawStore.includes(KEY_ONE))
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('clearStoredGeminiKeys removes stored keys', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-keys-'))
  const config = makeConfig(dataDir)
  try {
    await importGeminiKeys(config, KEY_ONE, false)
    const status = await clearStoredGeminiKeys(config)
    assert.equal(status.storedCount, 0)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('FileKeyStorageAdapter can lease environment fallback keys', async () => {
  const previousGeminiKey = process.env.GEMINI_API_KEY
  const previousGoogleKey = process.env.GOOGLE_API_KEY
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-keys-'))
  const config = makeConfig(dataDir)
  try {
    process.env.GEMINI_API_KEY = KEY_ONE
    delete process.env.GOOGLE_API_KEY
    const adapter = new FileKeyStorageAdapter(config)
    const keys = await adapter.getKeys()
    assert.equal(keys.length, 1)
    assert.equal(keys[0]?.id, -1)
    assert.equal(await adapter.acquireLease(-1, Date.now() + 1000, 'lease-token', Date.now()), true)
    assert.equal(await adapter.renewLease(-1, Date.now() + 2000, 'lease-token'), true)
  } finally {
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousGeminiKey
    if (previousGoogleKey === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = previousGoogleKey
    await rm(dataDir, { recursive: true, force: true })
  }
})

function makeConfig(dataDir: string): AutopilotConfig {
  return {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
}
