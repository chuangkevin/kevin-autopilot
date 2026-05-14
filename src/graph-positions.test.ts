import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadGraphPositions, saveGraphPositions } from './graph-positions.js'
import type { AutopilotConfig } from './types.js'

function makeConfig(dataDir: string): AutopilotConfig {
  return { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
}

test('loadGraphPositions returns {} when file is missing', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gpos-'))
  try {
    assert.deepEqual(await loadGraphPositions(makeConfig(dataDir)), {})
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveGraphPositions then loadGraphPositions round-trips', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gpos-'))
  try {
    const config = makeConfig(dataDir)
    const positions = { 'node-abc': { x: 120, y: 240 }, 'node-xyz': { x: 300, y: 100 } }
    await saveGraphPositions(config, positions)
    assert.deepEqual(await loadGraphPositions(config), positions)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('loadGraphPositions returns {} when file contains invalid JSON', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gpos-'))
  try {
    const config = makeConfig(dataDir)
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'graph-positions.json'), 'not-json', 'utf8')
    assert.deepEqual(await loadGraphPositions(config), {})
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('loadGraphPositions skips entries with non-numeric x/y', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gpos-'))
  try {
    const config = makeConfig(dataDir)
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'graph-positions.json'), JSON.stringify({ 'good': { x: 1, y: 2 }, 'bad': { x: 'oops', y: 2 } }), 'utf8')
    assert.deepEqual(await loadGraphPositions(config), { 'good': { x: 1, y: 2 } })
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
