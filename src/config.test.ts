import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './config.js'

test('loadConfig validates required fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-cfg-'))
  try {
    const cfgPath = join(dir, 'config.json')
    await writeFile(cfgPath, JSON.stringify({}))
    await assert.rejects(() => loadConfig(cfgPath), /Missing environment/)

    await writeFile(cfgPath, JSON.stringify({ environment: 'test' }))
    await assert.rejects(() => loadConfig(cfgPath), /Missing dataDir/)

    await writeFile(cfgPath, JSON.stringify({ environment: 'test', dataDir: dir }))
    const cfg = await loadConfig(cfgPath)
    assert.equal(cfg.environment, 'test')
    assert.equal(cfg.dataDir, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadConfig validates radarScan.intervalMs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-cfg-'))
  try {
    const cfgPath = join(dir, 'config.json')
    await writeFile(cfgPath, JSON.stringify({ environment: 'test', dataDir: dir, radarScan: { intervalMs: 100 } }))
    await assert.rejects(() => loadConfig(cfgPath), /intervalMs/)

    await writeFile(cfgPath, JSON.stringify({ environment: 'test', dataDir: dir, radarScan: { intervalMs: 3_600_000 } }))
    const cfg = await loadConfig(cfgPath)
    assert.equal(cfg.radarScan?.intervalMs, 3_600_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
