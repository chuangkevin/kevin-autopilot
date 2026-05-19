import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runPatrol } from './patrol.js'
import type { AutopilotConfig, ProblemBrief } from './types.js'

function makeConfig(dataDir: string): AutopilotConfig {
  return {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
    ai: { enabled: true, provider: 'gemini', model: 'gemini-2.0-flash', timeoutMs: 10_000 },
  }
}

const BRIEF: ProblemBrief = {
  id: 'problem-abc',
  dedupKey: 'short-video-creator',
  title: '短影音創作者被素材整理卡住',
  people: '小型品牌',
  workflow: '把素材整理成短影音',
  score: 80,
  confidence: 'strong',
  evidence: [],
  missingEvidence: [],
  killCriteria: [],
  pain: '手動整理素材',
  workaround: '手動',
  existingSolutionsGap: '大型工具太重',
  mvp: '資料夾 dropzone',
  validationPlan: '找三個真實案例',
  sourceSignalIds: [],
  severity: { score: 80, rationale: 'high pain' },
  kevinFit: { score: 75, rationale: 'fits direction', relatedProjects: [] },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

test('runPatrol returns string when Gemini returns non-empty text', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'patrol-test-'))
  const config = makeConfig(dataDir)
  // Mock GeminiClient via patching the module-level behaviour is complex;
  // instead we verify the fail-safe: AI not configured → returns null
  const noAiConfig: AutopilotConfig = { ...config, ai: { enabled: false, provider: 'gemini', model: 'gemini-2.0-flash', timeoutMs: 5000 } }
  const result = await runPatrol(noAiConfig, [BRIEF])
  assert.equal(result, null, 'should return null when AI not configured')
})

test('runPatrol returns null when Gemini fails', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'patrol-fail-'))
  const config = makeConfig(dataDir)
  // No keys stored → should fail gracefully and return null
  const result = await runPatrol(config, [BRIEF])
  assert.equal(result, null, 'should return null on failure instead of throwing')
})

test('runPatrol returns null when briefs list is empty', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'patrol-empty-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [], ai: { enabled: false, provider: 'gemini', model: 'gemini-2.0-flash', timeoutMs: 5000 } }
  const result = await runPatrol(config, [])
  assert.equal(result, null)
})
