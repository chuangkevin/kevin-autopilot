import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createIdea } from './ideas.js'
import { extendIdeaGraphNode, extractIdeaKeywords, getIdeaGraph, getIdeaGraphNodeDetail } from './idea-graph.js'
import { observe } from './observer.js'
import type { AutopilotConfig } from './types.js'

test('extractIdeaKeywords keeps useful typed idea terms', () => {
  const keywords = extractIdeaKeywords('Kevin Autopilot 要像分身大腦，可以延伸 agent 想法')
  assert.equal(keywords.includes('kevin'), true)
  assert.equal(keywords.includes('autopilot'), true)
  assert.equal(keywords.includes('agent'), true)
  assert.equal(keywords.includes('想法'), true)
})

test('idea graph persists nodes and explains relationships', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [{ name: 'kevin-autopilot', path: join(dataDir, 'missing-autopilot') }],
    services: [],
  }
  try {
    const idea = await createIdea(config, 'Kevin Autopilot 要做成分身大腦和神經網路圖，可以延伸想法')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [idea])

    assert.equal(graph.nodes.some((node) => node.type === 'double' && node.title === 'Kevin Autopilot'), true)
    assert.equal(graph.nodes.some((node) => node.type === 'idea' && node.source === `idea:${idea.id}`), true)
    assert.equal(graph.nodes.some((node) => node.type === 'project' && node.title === 'kevin-autopilot'), true)
    assert.equal(graph.edges.some((edge) => edge.type === 'contains_keyword' && edge.rationale.includes('關鍵字')), true)

    const ideaNode = graph.nodes.find((node) => node.type === 'idea')
    assert.ok(ideaNode)
    const detail = await getIdeaGraphNodeDetail(config, report, [idea], ideaNode.id)
    assert.equal(detail?.node.thinking.understanding.includes('我把這段文字理解成'), true)
    assert.equal((detail?.connectedNodes.length ?? 0) > 0, true)

    const reloaded = await getIdeaGraph(config, report, [idea])
    assert.equal(reloaded.nodes.some((node) => node.id === ideaNode.id), true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('extending graph node creates read-only research seed without web claims', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-extend-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const idea = await createIdea(config, '想研究 agent UI 和想法宇宙')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [idea])
    const ideaNode = graph.nodes.find((node) => node.type === 'idea')
    assert.ok(ideaNode)

    const detail = await extendIdeaGraphNode(config, report, [idea], ideaNode.id)
    assert.equal(detail?.node.type, 'extension')
    assert.equal(detail?.node.safety, 'read-only')
    assert.equal(detail?.connectedNodes.some((node) => node.type === 'research'), true)
    assert.equal(JSON.stringify(detail).includes('不代表已經查過網路') || JSON.stringify(detail).includes('未宣稱已搜尋 public web'), true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
