import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDeliberationRunning, loadLatestDeliberation, persistDeliberation } from './deliberation.js'
import type { AutopilotConfig, DeliberationRecord, DeliberationSynthesis, DeliberationPersona, PersonaRound } from './types.js'

function makeConfig(dataDir: string): AutopilotConfig {
  return {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
}

function makeRecord(id: string, dataDir: string): DeliberationRecord {
  const personas: DeliberationPersona[] = [
    { name: '技術評估師', perspective: '技術風險和技術債' },
    { name: '使用者觀察者', perspective: '使用者體驗和流程' },
  ]
  const round0: PersonaRound[] = personas.map((p) => ({
    persona: p,
    round: 0,
    analysis: `${p.name} 的分析`,
    keyInsights: ['洞察 1', '洞察 2'],
    challenges: ['挑戰 1'],
  }))
  const synthesis: DeliberationSynthesis = {
    summary: '合成摘要',
    consensusPoints: ['共識點 1'],
    blindspotsFound: ['盲點 1'],
    seeds: [],
    seedsInjected: 0,
  }
  return {
    id,
    startedAt: `2026-05-14T00:00:00.000Z`,
    finishedAt: `2026-05-14T00:01:00.000Z`,
    environment: 'test',
    personas,
    rounds: [round0],
    synthesis,
    model: 'gemini-test',
    tokenUsage: { input: 0, output: 0 },
  }
}

test('isDeliberationRunning returns false when no deliberation is running', () => {
  assert.equal(isDeliberationRunning(), false)
})

test('loadLatestDeliberation returns null when no records exist', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-deliberation-empty-'))
  try {
    const config = makeConfig(dataDir)
    const result = await loadLatestDeliberation(config)
    assert.equal(result, null)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('persistDeliberation then loadLatestDeliberation round-trips', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-deliberation-roundtrip-'))
  try {
    const config = makeConfig(dataDir)
    const record = makeRecord('2026-05-14-12-00-00', dataDir)
    await persistDeliberation(config, record)
    const loaded = await loadLatestDeliberation(config)
    assert.ok(loaded)
    assert.equal(loaded.id, record.id)
    assert.equal(loaded.synthesis.summary, '合成摘要')
    assert.equal(loaded.personas.length, 2)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('persistDeliberation prunes oldest records when count exceeds 10', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-deliberation-prune-'))
  try {
    const config = makeConfig(dataDir)
    const dir = join(dataDir, 'deliberations')
    await mkdir(dir, { recursive: true })
    for (let i = 1; i <= 10; i++) {
      const id = `2026-05-14-00-00-0${i < 10 ? '0' + i : i}`
      await writeFile(join(dir, `${id}.json`), JSON.stringify(makeRecord(id, dataDir)), 'utf8')
    }
    const newRecord = makeRecord('2026-05-14-00-00-11', dataDir)
    await persistDeliberation(config, newRecord)
    const files = await readdir(dir)
    assert.equal(files.length, 10, 'should prune to 10 records')
    const loaded = await loadLatestDeliberation(config)
    assert.equal(loaded?.id, '2026-05-14-00-00-11', 'latest should be the new record')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('persistDeliberation with synthesis zero seeds stores seedsInjected=0', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-deliberation-zeroseeds-'))
  try {
    const config = makeConfig(dataDir)
    const record = makeRecord('2026-05-14-12-00-00', dataDir)
    assert.equal(record.synthesis.seedsInjected, 0)
    assert.equal(record.synthesis.seeds.length, 0)
    await persistDeliberation(config, record)
    const loaded = await loadLatestDeliberation(config)
    assert.equal(loaded?.synthesis.seedsInjected, 0)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
