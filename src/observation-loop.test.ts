import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createObservationLoop } from './observation-loop.js'
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

    const persisted = JSON.parse(await readFile(join(dataDir, 'observation-loop-state.json'), 'utf8'))
    assert.equal(persisted.runCount, 1)
    assert.equal(persisted.lastSuccess, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
