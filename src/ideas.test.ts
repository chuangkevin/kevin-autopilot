import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeExistingProjects,
  countPendingAiIdeas,
  createAiIdeaFromSeed,
  createIdea,
  DismissError,
  dismissIdea,
  listDismissedAiIdeaTitles,
  listIdeas,
} from './ideas.js'
import type { AutopilotConfig, ReflectionIdeaSeed } from './types.js'

test('createIdea stores and classifies planning ideas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-idea-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir: root,
      ruleSources: [],
      repositories: [{ name: 'kevin-autopilot', path: join(root, 'kevin-autopilot') }],
      services: [{ name: 'Kevin Autopilot', source: 'config', repository: 'kevin-autopilot', domain: 'kevin.sisihome.org' }],
    }

    const idea = await createIdea(config, '我想強化 Kevin Autopilot repo，先定架構、規格、開發和測試')
    assert.equal(idea.classification, 'plan')
    assert.equal(idea.approvalRequired, true)
    assert.equal(idea.thinking.mode, 'deterministic-fallback')
    assert.equal(idea.existingProjectAnalysis.recommendation, 'extend-existing')
    assert.equal(idea.existingProjectAnalysis.matches[0]?.projectName, 'kevin-autopilot')
    assert.equal(idea.projectHandoff?.mode, 'read-only-project-handoff')
    assert.ok(idea.projectHandoff?.implementationTasks.includes('撰寫 OpenSpec proposal'))

    const ideas = await listIdeas(config)
    assert.equal(ideas.length, 1)
    assert.equal(ideas[0]?.id, idea.id)
    assert.equal(ideas[0]?.projectHandoff?.repoName, idea.projectHandoff?.repoName)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('analyzeExistingProjects returns new-project when no configured project matches', () => {
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir: 'data',
    ruleSources: [],
    repositories: [{ name: 'media-processor', path: 'D:/GitClone/_HomeProject/media-processor' }],
    services: [{ name: 'Vehicle Dashboard', source: 'config', repository: 'vehicle-dashboard', domain: 'cars.sisihome.org' }],
  }

  const analysis = analyzeExistingProjects(config, '我要做一個消防課程自動填問卷的小工具')
  assert.equal(analysis.recommendation, 'new-project')
  assert.equal(analysis.matches.length, 0)
})

test('createIdea blocks risky deployment ideas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-idea-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir: root,
      ruleSources: [],
      repositories: [],
      services: [],
    }

    const idea = await createIdea(config, '幫我直接部署到 production 並讀 .env')
    assert.equal(idea.classification, 'blocked')
    assert.equal(idea.approvalRequired, true)
    assert.equal(idea.thinking.mode, 'deterministic-fallback')
    assert.equal(idea.projectHandoff?.firstArtifact, 'risk review + approval checklist')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createAiIdeaFromSeed mints unique ids per index and marks aiSource', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-ai-idea-'))
  try {
    const config: AutopilotConfig = { environment: 'test', dataDir: root, ruleSources: [], repositories: [], services: [] }
    const seed: ReflectionIdeaSeed = {
      title: 'Test AI seed',
      rawText: 'AI 反思根據 backlog X 與 idea Y 推導出的方向。',
      evidence: ['node:idea-foo', 'backlog:repo-bar'],
      approvalRequired: false,
    }
    const now = new Date('2026-05-13T08:00:00.000Z')
    const first = await createAiIdeaFromSeed(config, seed, { generatedAt: now.toISOString(), model: 'gemini-flash' }, 0, now)
    const second = await createAiIdeaFromSeed(config, seed, { generatedAt: now.toISOString(), model: 'gemini-flash' }, 1, now)
    assert.notEqual(first.id, second.id)
    assert.match(first.id, /-r1$/)
    assert.match(second.id, /-r2$/)
    assert.equal(first.aiSource, 'ai-reflection')
    assert.deepEqual(first.aiReflection?.evidence, ['node:idea-foo', 'backlog:repo-bar'])
    assert.equal(first.thinking.mode, 'ai-core')
    assert.equal(first.classification, 'explore')
    assert.equal(first.approvalRequired, false)
    const stored = await listIdeas(config, 40)
    assert.equal(stored.length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createAiIdeaFromSeed forces approvalRequired when rawText hits BLOCKED_TERMS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-ai-idea-blocked-'))
  try {
    const config: AutopilotConfig = { environment: 'test', dataDir: root, ruleSources: [], repositories: [], services: [] }
    const seed: ReflectionIdeaSeed = {
      title: 'Touches deployment',
      rawText: '部署到 production 並更新 secret',
      evidence: ['node:idea-foo'],
      approvalRequired: false,
    }
    const now = new Date()
    const idea = await createAiIdeaFromSeed(config, seed, { generatedAt: now.toISOString(), model: 'gemini-flash' }, 0, now)
    assert.equal(idea.classification, 'blocked')
    assert.equal(idea.approvalRequired, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('countPendingAiIdeas counts ai-reflection ideas only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-pending-count-'))
  try {
    const config: AutopilotConfig = { environment: 'test', dataDir: root, ruleSources: [], repositories: [], services: [] }
    const seed: ReflectionIdeaSeed = {
      title: 'AI seed',
      rawText: 'AI 反思產生的 idea',
      evidence: ['node:idea-foo'],
    }
    const now = new Date('2026-05-17T00:00:00.000Z')
    await createAiIdeaFromSeed(config, seed, { generatedAt: now.toISOString(), model: 'gemini-flash' }, 0, now)
    await createAiIdeaFromSeed(config, seed, { generatedAt: now.toISOString(), model: 'gemini-flash' }, 1, now)
    await createAiIdeaFromSeed(config, seed, { generatedAt: '2026-05-12T00:00:00.000Z', model: 'gemini-flash' }, 2, new Date('2026-05-12T00:00:00.000Z'))
    await createIdea(config, '使用者自己打的想法')
    assert.equal(await countPendingAiIdeas(config, now), 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dismissIdea moves AI ideas to ideas-dismissed and refuses user ideas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-dismiss-'))
  try {
    const config: AutopilotConfig = { environment: 'test', dataDir: root, ruleSources: [], repositories: [], services: [] }
    const userIdea = await createIdea(config, '一般使用者想法不能被 dismiss')
    await assert.rejects(() => dismissIdea(config, userIdea.id), (error: unknown) => {
      assert.ok(error instanceof DismissError)
      assert.equal((error as DismissError).code, 'not-ai-idea')
      return true
    })

    const seed: ReflectionIdeaSeed = {
      title: 'AI seed',
      rawText: 'AI 反思產生的 idea，可以被略過。',
      evidence: ['node:idea-foo'],
    }
    const now = new Date()
    const aiIdea = await createAiIdeaFromSeed(config, seed, { generatedAt: now.toISOString(), model: 'gemini-flash' }, 0, now)
    const dismissed = await dismissIdea(config, aiIdea.id)
    assert.equal(dismissed.dismissedAt !== undefined, true)
    const remaining = await listIdeas(config, 40)
    assert.equal(remaining.some((idea) => idea.id === aiIdea.id), false)
    const dismissedTitles = await listDismissedAiIdeaTitles(config, 20)
    assert.equal(dismissedTitles.includes(seed.title), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dismissIdea returns not-found for unknown id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-dismiss-404-'))
  try {
    const config: AutopilotConfig = { environment: 'test', dataDir: root, ruleSources: [], repositories: [], services: [] }
    await assert.rejects(() => dismissIdea(config, 'idea-does-not-exist'), (error: unknown) => {
      assert.ok(error instanceof DismissError)
      assert.equal((error as DismissError).code, 'not-found')
      return true
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
