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
    aiReflection: { enabled: false, maxOutputTokens: 700, maxPendingAiIdeas: 5 },
    backgroundObservation: { enabled: true, intervalMs: 300_000 },
    ruleSources: [],
    repositories: [],
    services: [],
  }
}

test('loadRuntimeOverrides returns empty object when file is missing', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-overrides-missing-'))
  try {
    assert.deepEqual(await loadRuntimeOverrides(baseConfig(dataDir)), {})
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('loadRuntimeOverrides drops invalid and unknown hand-edited fields', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-overrides-invalid-'))
  try {
    await writeFile(join(dataDir, 'runtime-overrides.json'), JSON.stringify({
      aiReflection: {
        enabled: true,
        maxPendingAiIdeas: 'many',
        maxOutputTokens: 80,
      },
      backgroundObservation: {
        enabled: false,
        intervalMs: 60_000,
      },
      repositories: [],
    }), 'utf8')
    assert.deepEqual(await loadRuntimeOverrides(baseConfig(dataDir)), {
      aiReflection: { enabled: true },
      backgroundObservation: { enabled: false, intervalMs: 60_000 },
    })
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('getEffectiveConfig merges whitelisted overrides without mutating file config', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-overrides-effective-'))
  try {
    const config = baseConfig(dataDir)
    await saveRuntimeOverrides(config, {
      aiReflection: { enabled: true, maxPendingAiIdeas: 12 },
      backgroundObservation: { intervalMs: 120_000 },
    })
    const effective = await getEffectiveConfig(config)
    assert.equal(effective.aiReflection?.enabled, true)
    assert.equal(effective.aiReflection?.maxOutputTokens, 700)
    assert.equal(effective.aiReflection?.maxPendingAiIdeas, 12)
    assert.equal(effective.backgroundObservation?.intervalMs, 120_000)
    assert.equal(config.aiReflection?.enabled, false)
    assert.equal(config.backgroundObservation?.intervalMs, 300_000)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveRuntimeOverrides allows larger reflection JSON budgets', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-overrides-reflection-budget-'))
  try {
    const config = baseConfig(dataDir)
    await saveRuntimeOverrides(config, { aiReflection: { maxOutputTokens: 3000 } })
    const effective = await getEffectiveConfig(config)
    assert.equal(effective.aiReflection?.maxOutputTokens, 3000)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveRuntimeOverrides rejects unknown keys and preserves existing overrides', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-overrides-reject-'))
  try {
    const config = baseConfig(dataDir)
    await saveRuntimeOverrides(config, { aiReflection: { enabled: true } })
    await assert.rejects(
      () => saveRuntimeOverrides(config, { ai: { model: 'gemini-pro' } }),
      (error: unknown) => error instanceof RuntimeOverrideError && error.code === 'not-in-whitelist' && error.key === 'ai.model',
    )
    assert.deepEqual(await loadRuntimeOverrides(config), { aiReflection: { enabled: true } })
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveRuntimeOverrides treats null as removing an override', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-overrides-null-'))
  try {
    const config = baseConfig(dataDir)
    await saveRuntimeOverrides(config, { aiReflection: { enabled: true, maxPendingAiIdeas: 10 } })
    assert.deepEqual(await saveRuntimeOverrides(config, { aiReflection: { enabled: null } }), {
      aiReflection: { maxPendingAiIdeas: 10 },
    })
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('applyRuntimeOverrides accepts dotted keys through sanitized loaded overrides only', () => {
  const config = baseConfig('data')
  const effective = applyRuntimeOverrides(config, { backgroundObservation: { enabled: false } })
  assert.equal(effective.backgroundObservation?.enabled, false)
  assert.equal(config.backgroundObservation?.enabled, true)
})
