import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeExistingProjects, createIdea, listIdeas } from './ideas.js'
import type { AutopilotConfig } from './types.js'

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
