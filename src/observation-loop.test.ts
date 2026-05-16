import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createObservationLoop, readReflectionState } from './observation-loop.js'
import { listBacklog, openBacklogDatabase } from './backlog.js'
import { saveRuntimeOverrides } from './runtime-overrides.js'
import type { AutopilotConfig } from './types.js'

test('ObservationLoop runs read-only observation and persists loop state', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-loop-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: true, intervalMs: 60_000 },
      ruleSources: [],
      repositories: [{ name: 'missing-repo', path: join(dataDir, 'missing') }],
      services: [],
    }

    const loop = createObservationLoop(config)
    const report = await loop.runOnce()
    const state = loop.getState()
    loop.stop()

    assert.equal(report?.environment, 'test')
    assert.equal(state.mode, 'read-only-background-observation')
    assert.equal(state.enabled, true)
    assert.equal(state.running, false)
    assert.equal(state.runCount, 1)
    assert.equal(state.lastSuccess, true)
    assert.ok(state.nextRunAt)
    assert.ok(state.lastReportPath?.endsWith('.json'))
    assert.ok(state.lastGraphAt)
    assert.ok(state.lastProblemDiscoveryAt)
    assert.equal(typeof state.lastProblemDiscoveryBriefCount, 'number')

    const persisted = JSON.parse(await readFile(join(dataDir, 'observation-loop-state.json'), 'utf8'))
    assert.equal(persisted.runCount, 1)
    assert.equal(persisted.lastSuccess, true)
    assert.equal(typeof persisted.lastProblemDiscoveryBriefCount, 'number')
    const graph = JSON.parse(await readFile(join(dataDir, 'idea-graph.json'), 'utf8'))
    assert.equal(graph.nodes.some((node: { type: string }) => node.type === 'double'), true)
    assert.ok(state.lastBacklogAt)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('two observation cycles upsert the same candidate into the backlog with seen_count=2', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-loop-backlog-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: true, intervalMs: 60_000 },
      ruleSources: [],
      repositories: [{ name: 'missing-repo', path: join(dataDir, 'missing') }],
      services: [],
    }

    const loop = createObservationLoop(config)
    const firstReport = await loop.runOnce()
    await loop.runOnce()
    loop.stop()

    assert.ok(firstReport && firstReport.candidates.length > 0, 'first cycle should produce at least one candidate')

    const db = openBacklogDatabase(config)
    try {
      const items = listBacklog(db, 'all', new Date())
      assert.ok(items.length > 0, 'backlog should contain merged candidates')
      const item = items.find((row) => row.id === firstReport!.candidates[0].id)
      assert.ok(item)
      assert.equal(item.seenCount, 2)
      assert.equal(item.missCount, 0)
      assert.equal(item.strength, 'medium')
    } finally {
      db.close()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('observation cycle records reflection skip when AI reflection is disabled', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-loop-reflection-disabled-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: true, intervalMs: 60_000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }
    const loop = createObservationLoop(config)
    await loop.runOnce()
    loop.stop()

    const reflection = await readReflectionState(config)
    assert.ok(reflection, 'reflection state file should exist after a cycle')
    assert.equal(reflection!.skipped, true)
    if (reflection!.skipped === true) {
      assert.equal(reflection!.reason, 'disabled')
    }
    assert.equal(loop.getState().lastReflectionAt !== undefined, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('observation cycle still succeeds when reflection module throws', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-loop-reflection-error-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: true, intervalMs: 60_000 },
      ruleSources: [],
      repositories: [],
      services: [],
      aiReflection: { enabled: true },
    }
    const loop = createObservationLoop(config)
    const report = await loop.runOnce()
    const state = loop.getState()
    loop.stop()

    assert.ok(report)
    assert.equal(state.lastSuccess, true)
    const reflection = await readReflectionState(config)
    assert.ok(reflection)
    assert.equal(reflection!.skipped, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('observation loop reads runtime overrides for reflection and scheduling', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-loop-runtime-overrides-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      ai: { enabled: true, provider: 'gemini', model: 'gemini-test' },
      aiReflection: { enabled: false },
      backgroundObservation: { enabled: true, intervalMs: 60_000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }
    await saveRuntimeOverrides(config, { aiReflection: { enabled: true } })

    const loop = createObservationLoop(config)
    assert.ok(await loop.runOnce())
    const reflection = await readReflectionState(config)
    assert.ok(reflection)
    assert.equal(reflection!.skipped, true)
    if (reflection!.skipped === true) assert.notEqual(reflection!.reason, 'disabled')

    await saveRuntimeOverrides(config, { backgroundObservation: { enabled: false } })
    assert.ok(await loop.runOnce())
    const state = await loop.getEffectiveState()
    loop.stop()

    assert.equal(state.enabled, false)
    assert.equal(state.nextRunAt, undefined)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('ObservationLoop reports excited mode after cycle with high excitement, then cools', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-adaptive-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: false, intervalMs: 300_000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }
    const loop = createObservationLoop(config)

    await loop.runOnce()
    const state = loop.getState()
    loop.stop()

    // empty dataDir → no seeds, no interesting nodes, no spikes → score=0, mode=normal
    assert.equal(state.lastExcitementScore, 0)
    assert.equal(state.excitementMode, 'normal')
    assert.equal(state.currentIntervalMs, state.baseIntervalMs)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('ObservationLoop currentIntervalMs starts at baseIntervalMs', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-base-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: false, intervalMs: 120_000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }
    const loop = createObservationLoop(config)
    const state = loop.getState()
    loop.stop()

    assert.equal(state.baseIntervalMs, 120_000)
    assert.equal(state.currentIntervalMs, 120_000)
    assert.equal(state.excitementMode, 'normal')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('forceRun fires full cycle even when enabled is false', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-force-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: false, intervalMs: 60_000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }
    const loop = createObservationLoop(config)
    const report = await loop.forceRun()
    const state = loop.getState()
    loop.stop()

    assert.ok(report, 'forceRun should return a report even when enabled=false')
    assert.equal(state.runCount, 1)
    assert.equal(state.lastSuccess, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('forceRun waits for in-flight runOnce before starting a new cycle', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-force-inflight-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: true, intervalMs: 60_000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }
    const loop = createObservationLoop(config)
    const first = loop.runOnce()
    const second = loop.forceRun()
    await Promise.all([first, second])
    const state = loop.getState()
    loop.stop()

    assert.equal(state.runCount, 2, 'both runOnce and forceRun should each count as a separate cycle')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
