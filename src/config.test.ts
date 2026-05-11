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

test('loadConfig validates background observation interval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-config-'))
  try {
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({
      environment: 'test',
      dataDir: root,
      backgroundObservation: { intervalMs: 1000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }), 'utf8')
    await assert.rejects(() => loadConfig(configPath), /backgroundObservation\.intervalMs/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loadConfig validates background observation enabled type', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-config-'))
  try {
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({
      environment: 'test',
      dataDir: root,
      backgroundObservation: { enabled: 'false' },
      ruleSources: [],
      repositories: [],
      services: [],
    }), 'utf8')
    await assert.rejects(() => loadConfig(configPath), /backgroundObservation\.enabled/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loadConfig validates background observation object type', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-config-'))
  try {
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({
      environment: 'test',
      dataDir: root,
      backgroundObservation: 'enabled',
      ruleSources: [],
      repositories: [],
      services: [],
    }), 'utf8')
    await assert.rejects(() => loadConfig(configPath), /backgroundObservation must be an object/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
