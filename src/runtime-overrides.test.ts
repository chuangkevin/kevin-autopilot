import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  applyRuntimeOverrides,
  getEffectiveConfig,
  loadRuntimeOverrides,
  RuntimeOverrideError,
  saveRuntimeOverrides,
} from './runtime-overrides.js'
import type { AutopilotConfig } from './types.js'

function baseConfig(dataDir: string): AutopilotConfig {
  return {
    environment: 'test',
    dataDir,
    radarScan: { intervalMs: 4 * 60 * 60 * 1000 },
  }
}

test('loadRuntimeOverrides returns empty object when file is missing', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-radar-overrides-missing-'))
  try {
    assert.deepEqual(await loadRuntimeOverrides(baseConfig(dataDir)), {})
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveRuntimeOverrides accepts radarScan keys', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-radar-overrides-save-'))
  try {
    const config = baseConfig(dataDir)
    const saved = await saveRuntimeOverrides(config, {
      'radarScan.enabled': true,
      'radarScan.intervalMs': 600_000,
    })
    assert.deepEqual(saved, {
      radarScan: { enabled: true, intervalMs: 600_000 },
    })
    assert.deepEqual(await loadRuntimeOverrides(config), {
      radarScan: { enabled: true, intervalMs: 600_000 },
    })
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveRuntimeOverrides rejects unknown keys', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-radar-overrides-reject-'))
  try {
    const config = baseConfig(dataDir)
    await assert.rejects(
      () => saveRuntimeOverrides(config, { 'ai.model': 'gemini-pro' }),
      (error: unknown) => error instanceof RuntimeOverrideError,
    )
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveRuntimeOverrides enforces intervalMs range', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-radar-overrides-range-'))
  try {
    const config = baseConfig(dataDir)
    await assert.rejects(
      () => saveRuntimeOverrides(config, { 'radarScan.intervalMs': 100 }),
      (error: unknown) => error instanceof RuntimeOverrideError,
    )
    await assert.rejects(
      () => saveRuntimeOverrides(config, { 'radarScan.intervalMs': 99_999_999 }),
      (error: unknown) => error instanceof RuntimeOverrideError,
    )
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveRuntimeOverrides rejects non-boolean values for boolean fields', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-radar-overrides-bool-'))
  try {
    const config = baseConfig(dataDir)
    await assert.rejects(
      () => saveRuntimeOverrides(config, { 'radarScan.enabled': 'true' }),
      (error: unknown) => error instanceof RuntimeOverrideError,
    )
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('getEffectiveConfig merges overrides over base config', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-radar-overrides-effective-'))
  try {
    const config = baseConfig(dataDir)
    await writeFile(join(dataDir, 'runtime-overrides.json'), JSON.stringify({
      radarScan: { intervalMs: 600_000 },
    }), 'utf8')
    const effective = await getEffectiveConfig(config)
    assert.equal(effective.radarScan?.intervalMs, 600_000)
    assert.equal(config.radarScan?.intervalMs, 4 * 60 * 60 * 1000)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('applyRuntimeOverrides merges radarScan partial', () => {
  const config = baseConfig('data')
  const effective = applyRuntimeOverrides(config, { radarScan: { enabled: false } })
  assert.equal(effective.radarScan?.enabled, false)
  assert.equal(effective.radarScan?.intervalMs, 4 * 60 * 60 * 1000)
})
