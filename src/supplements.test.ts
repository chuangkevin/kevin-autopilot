import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSupplement, listSupplements } from './supplements.js'
import type { AutopilotConfig } from './types.js'

function makeConfig(dataDir: string): AutopilotConfig {
  return {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
}

test('createSupplement stores dashboard supplements for the next observation', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-supplements-'))
  try {
    const config = makeConfig(dataDir)
    const supplement = await createSupplement(config, '下一輪先看 dashboard UX，不要碰部署。')
    const secondSupplement = await createSupplement(config, '第二則補充也要保留。')

    assert.equal(supplement.source, 'dashboard')
    assert.equal(supplement.appliesTo, 'next_observation')
    assert.equal(supplement.rawText, '下一輪先看 dashboard UX，不要碰部署。')
    assert.notEqual(secondSupplement.id, supplement.id)

    const supplements = await listSupplements(config)
    assert.equal(supplements.length, 2)
    assert.equal(new Set(supplements.map((entry) => entry.id)).size, 2)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('createSupplement rejects common secret-like values', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-supplements-'))
  try {
    const config = makeConfig(dataDir)
    await assert.rejects(
      () => createSupplement(config, 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456'),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, `GEMINI_API_KEY=AIzaSy${'A'.repeat(33)}`),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, 'NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz'),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, 'apiKey=abcdefghijklmnopqrstuvwxyz'),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz'),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, '{"Authorization":"Bearer abcdefghijklmnopqrstuvwxyz"}'),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, 'Authorization=Bearer abcdefghijklmnopqrstuvwxyz'),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, 'AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP'),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, '{"apiKey":"abcdefghijklmnopqrstuvwxyz"}'),
      /secret value/i,
    )
    await assert.rejects(
      () => createSupplement(config, '{"accessToken":"abcdefghijklmnopqrstuvwxyz"}'),
      /secret value/i,
    )
    assert.equal((await listSupplements(config)).length, 0)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
