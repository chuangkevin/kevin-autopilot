import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createIdea, listIdeas } from './ideas.js'
import type { AutopilotConfig } from './types.js'

test('createIdea stores and classifies planning ideas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-idea-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir: root,
      ruleSources: [],
      repositories: [],
      services: [],
    }

    const idea = await createIdea(config, '我想開一個 repo，先定架構、規格、開發和測試')
    assert.equal(idea.classification, 'plan')
    assert.equal(idea.approvalRequired, true)
    assert.equal(idea.thinking.mode, 'deterministic-fallback')

    const ideas = await listIdeas(config)
    assert.equal(ideas.length, 1)
    assert.equal(ideas[0]?.id, idea.id)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
