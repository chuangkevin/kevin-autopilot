import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from './config.js'

test('loadConfig validates required arrays', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-config-'))
  try {
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({ environment: 'test', dataDir: root }), 'utf8')
    await assert.rejects(() => loadConfig(configPath), /Missing ruleSources array/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
