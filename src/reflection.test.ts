import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeReflectionSignature, parseReflectionOutput, resolveReflectionMaxOutputTokens, summarizeAiReflectionText } from './reflection.js'
import type {
  AutopilotConfig,
  BacklogItem,
  IdeaGraph,
  IdeaGraphNode,
} from './types.js'

const NOW = '2026-05-13T08:00:00.000Z'

function makeNode(id: string, type: IdeaGraphNode['type'] = 'idea'): IdeaGraphNode {
  return {
    id,
    type,
    title: id,
    summary: `${id} summary`,
    source: `source:${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    confidence: 'medium',
    safety: 'read-only',
    keywords: ['agent', 'cockpit'],
    relatedProjectNames: [],
    thinking: { understanding: 'u', whyItMatters: 'w', nextExploration: 'n', evidence: [], missingEvidence: [] },
    actions: [],
  }
}

function makeGraph(nodes: IdeaGraphNode[]): IdeaGraph {
  return {
    generatedAt: NOW,
    centerNodeId: nodes[0]?.id ?? 'center',
    nodes,
    edges: [],
    focus: { status: '', headline: '', nextThought: '' },
  }
}

function makeBacklog(id: string, seenCount = 1, lastSeenAt = NOW): BacklogItem {
  return {
    id,
    kind: 'bug_watch',
    sourceType: 'repository',
    sourceName: id,
    title: id,
    summary: '',
    evidence: [],
    prevEvidence: null,
    firstSeenAt: NOW,
    lastSeenAt,
    seenCount,
    missCount: 0,
    status: 'active',
    snoozedUntil: null,
    strength: 'medium',
    updatedAt: NOW,
  }
}

test('computeReflectionSignature is stable and order-independent', () => {
  const graphA = makeGraph([makeNode('a'), makeNode('b'), makeNode('c')])
  const graphB = makeGraph([makeNode('c'), makeNode('a'), makeNode('b')])
  const backlogA = [makeBacklog('one'), makeBacklog('two', 2)]
  const backlogB = [makeBacklog('two', 2), makeBacklog('one')]
  assert.equal(computeReflectionSignature(graphA, backlogA), computeReflectionSignature(graphB, backlogB))
})

test('computeReflectionSignature changes when a node is added', () => {
  const before = makeGraph([makeNode('a'), makeNode('b')])
  const after = makeGraph([makeNode('a'), makeNode('b'), makeNode('c')])
  assert.notEqual(computeReflectionSignature(before, []), computeReflectionSignature(after, []))
})

test('computeReflectionSignature changes when backlog seenCount changes', () => {
  const graph = makeGraph([makeNode('a')])
  const before = [makeBacklog('one', 1)]
  const after = [makeBacklog('one', 2)]
  assert.notEqual(computeReflectionSignature(graph, before), computeReflectionSignature(graph, after))
})

test('parseReflectionOutput truncates seeds to maxNewSeeds and drops empty-evidence seeds', () => {
  const text = JSON.stringify({
    newIdeaSeeds: [
      { title: 'a', rawText: 'a body', evidence: ['n1'] },
      { title: 'b', rawText: 'b body', evidence: [] },
      { title: 'c', rawText: 'c body', evidence: ['n2'] },
      { title: 'd', rawText: 'd body', evidence: ['n3'] },
    ],
    nextExplorationRewrites: [],
  })
  const result = parseReflectionOutput(text, {
    knownNodeIds: new Set(['n1', 'n2', 'n3']),
    maxNewSeeds: 2,
  })
  assert.equal(result.newIdeaSeeds.length, 2)
  assert.equal(result.newIdeaSeeds[0].title, 'a')
  assert.equal(result.newIdeaSeeds[1].title, 'c')
})

test('parseReflectionOutput respects maxNewSeeds = 0 even when AI returns seeds', () => {
  const text = JSON.stringify({
    newIdeaSeeds: [
      { title: 'a', rawText: 'body', evidence: ['n1'] },
    ],
    nextExplorationRewrites: [
      { nodeId: 'n1', nextExploration: 'rewrite' },
    ],
  })
  const result = parseReflectionOutput(text, {
    knownNodeIds: new Set(['n1']),
    maxNewSeeds: 0,
  })
  assert.equal(result.newIdeaSeeds.length, 0)
  assert.equal(result.nextExplorationRewrites.length, 1)
})

test('parseReflectionOutput drops rewrites whose nodeId is not in knownNodeIds', () => {
  const text = JSON.stringify({
    newIdeaSeeds: [],
    nextExplorationRewrites: [
      { nodeId: 'unknown', nextExploration: 'hi' },
      { nodeId: 'n1', nextExploration: 'real' },
    ],
  })
  const result = parseReflectionOutput(text, {
    knownNodeIds: new Set(['n1']),
    maxNewSeeds: 2,
  })
  assert.equal(result.nextExplorationRewrites.length, 1)
  assert.equal(result.nextExplorationRewrites[0].nodeId, 'n1')
})

test('parseReflectionOutput caps rewrites to 1', () => {
  const text = JSON.stringify({
    newIdeaSeeds: [],
    nextExplorationRewrites: [
      { nodeId: 'n1', nextExploration: 'first' },
      { nodeId: 'n2', nextExploration: 'second' },
    ],
  })
  const result = parseReflectionOutput(text, {
    knownNodeIds: new Set(['n1', 'n2']),
    maxNewSeeds: 2,
  })
  assert.equal(result.nextExplorationRewrites.length, 1)
  assert.equal(result.nextExplorationRewrites[0].nodeId, 'n1')
})

test('parseReflectionOutput accepts JSON wrapped in code fences', () => {
  const text = '```json\n{"newIdeaSeeds":[],"nextExplorationRewrites":[]}\n```'
  const result = parseReflectionOutput(text, { knownNodeIds: new Set(), maxNewSeeds: 2 })
  assert.deepEqual(result, { newIdeaSeeds: [], nextExplorationRewrites: [] })
})

test('parseReflectionOutput throws when no JSON is present', () => {
  assert.throws(() => parseReflectionOutput('hello world', { knownNodeIds: new Set(), maxNewSeeds: 2 }))
})

test('summarizeAiReflectionText makes parse failures diagnosable without huge details', () => {
  const summary = summarizeAiReflectionText(`\n\nI cannot comply with JSON only. ${'x'.repeat(400)}`)
  assert.match(summary, /^"I cannot comply with JSON only\./)
  assert.equal(summary.endsWith('..."'), true)
  assert.equal(summary.length <= 285, true)
  assert.equal(summarizeAiReflectionText('   \n '), '<empty>')
})

test('parseReflectionOutput truncates over-long fields', () => {
  const longTitle = 'a'.repeat(200)
  const longRaw = 'b'.repeat(500)
  const longRewrite = 'c'.repeat(400)
  const text = JSON.stringify({
    newIdeaSeeds: [{ title: longTitle, rawText: longRaw, evidence: ['n1'] }],
    nextExplorationRewrites: [{ nodeId: 'n1', nextExploration: longRewrite }],
  })
  const result = parseReflectionOutput(text, { knownNodeIds: new Set(['n1']), maxNewSeeds: 2 })
  assert.equal(result.newIdeaSeeds[0].title.length <= 60, true)
  assert.equal(result.newIdeaSeeds[0].rawText.length <= 320, true)
  assert.equal(result.nextExplorationRewrites[0].nextExploration.length <= 140, true)
})

test('resolveReflectionMaxOutputTokens keeps a safe JSON floor', () => {
  assert.equal(resolveReflectionMaxOutputTokens({}), 1200)
  assert.equal(resolveReflectionMaxOutputTokens({ maxOutputTokens: 300 }), 700)
  assert.equal(resolveReflectionMaxOutputTokens({ maxOutputTokens: 2000 }), 2000)
})

test('reflect skips when aiReflection is disabled', async () => {
  const { reflect } = await import('./reflection.js')
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-reflect-disabled-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const result = await reflect({
      config,
      graph: makeGraph([makeNode('a')]),
      backlog: [],
      recentIdeas: [],
      dismissedAiIdeaTitles: [],
      pendingAiIdeaCount: 0,
    })
    assert.equal(result.skipped, true)
    assert.equal(result.skipped === true && result.reason, 'disabled')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('reflect skips with reason=unchanged when previousSignature matches', async () => {
  const { reflect } = await import('./reflection.js')
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-reflect-unchanged-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
    ai: { enabled: true, provider: 'gemini', model: 'gemini-flash' },
    aiReflection: { enabled: true },
  }
  try {
    const graph = makeGraph([makeNode('a')])
    const signature = computeReflectionSignature(graph, [])
    const result = await reflect({
      config,
      graph,
      backlog: [],
      recentIdeas: [],
      previousSignature: signature,
      dismissedAiIdeaTitles: [],
      pendingAiIdeaCount: 0,
    })
    assert.equal(result.skipped, true)
    assert.equal(result.skipped === true && result.reason, 'unchanged')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
