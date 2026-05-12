import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dismissBacklogItem,
  mergeCandidatesIntoBacklog,
  openBacklogDatabase,
  snoozeBacklogItem,
} from './backlog.js'
import { createIdea } from './ideas.js'
import {
  extendIdeaGraphNode,
  extractIdeaKeywords,
  findIdeaGraphNodeRelationships,
  getIdeaGraph,
  getIdeaGraphNodeDetail,
  markIdeaGraphNodeInteresting,
  stopExploringIdeaGraphNode,
} from './idea-graph.js'
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

test('idea graph automatically grows extension nodes from idea next steps', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-auto-extend-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const idea = await createIdea(config, '我想讓分身依照我的想法自己延伸探索節點')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [idea])
    const ideaNode = graph.nodes.find((node) => node.type === 'idea' && node.source === `idea:${idea.id}`)
    assert.ok(ideaNode)
    const extensionNodes = graph.nodes.filter((node) => node.type === 'extension' && node.source.startsWith(`idea-extension:${idea.id}:`))

    assert.equal(extensionNodes.length > 0, true)
    assert.equal(extensionNodes.every((node) => node.safety === 'read-only'), true)
    assert.equal(extensionNodes.every((node) => node.actions.find((action) => action.id === 'copy-opencode-prompt')?.enabled), true)
    assert.equal(graph.edges.some((edge) => edge.from === ideaNode.id && edge.to === extensionNodes[0].id && edge.type === 'extends'), true)
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

test('graph node actions can mark interesting, find relationships, create prompts, and stop exploring', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-actions-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const ideaA = await createIdea(config, '想做 agent cockpit 和 OpenCode prompt 工作流')
    const ideaB = await createIdea(config, 'OpenCode prompt 可以接到 agent cockpit 節點')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [ideaA, ideaB])
    const ideaNode = graph.nodes.find((node) => node.type === 'idea' && node.source === `idea:${ideaA.id}`)
    assert.ok(ideaNode)
    assert.equal(ideaNode.actions.find((action) => action.id === 'copy-opencode-prompt')?.enabled, true)
    assert.equal(typeof ideaNode.prompt, 'string')
    assert.match(ideaNode.prompt ?? '', /do not .*edit target repos/i)

    const marked = await markIdeaGraphNodeInteresting(config, report, [ideaA, ideaB], ideaNode.id)
    assert.equal(marked?.node.interesting, true)
    assert.equal(marked?.node.actions.find((action) => action.id === 'mark-interesting')?.enabled, false)

    const related = await findIdeaGraphNodeRelationships(config, report, [ideaA, ideaB], ideaNode.id)
    assert.ok((related?.connectedNodes.length ?? 0) > 0)
    assert.equal(related?.edges.some((edge) => edge.source === `relationship:${ideaNode.id}`), true)

    const hidden = await stopExploringIdeaGraphNode(config, report, [ideaA, ideaB], ideaNode.id)
    assert.equal(hidden?.node.ignored, true)
    const refreshed = await getIdeaGraph(config, report, [ideaA, ideaB])
    assert.equal(refreshed.nodes.some((node) => node.id === ideaNode.id), false)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('graph node actions only mutate Autopilot-owned graph metadata', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-action-scope-'))
  const targetRepo = join(dataDir, 'target-repo')
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [{ name: 'target-repo', path: targetRepo }],
    services: [],
  }
  try {
    await mkdir(targetRepo, { recursive: true })
    await writeFile(join(targetRepo, 'sentinel.txt'), 'target repo must remain untouched\n', 'utf8')
    const idea = await createIdea(config, 'target repo agent cockpit prompt 關聯')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [idea])
    const ideaNode = graph.nodes.find((node) => node.type === 'idea')
    assert.ok(ideaNode)

    const before = await snapshotFiles(dataDir)
    await markIdeaGraphNodeInteresting(config, report, [idea], ideaNode.id)
    await findIdeaGraphNodeRelationships(config, report, [idea], ideaNode.id)
    await stopExploringIdeaGraphNode(config, report, [idea], ideaNode.id)
    const after = await snapshotFiles(dataDir)

    assert.deepEqual(changedFiles(before, after), ['idea-graph.json'])
    assert.equal(after.get('target-repo/sentinel.txt'), before.get('target-repo/sentinel.txt'))
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('signal node confidence comes from backlog strength when available', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-strength-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [{ name: 'kevin-autopilot', path: join(dataDir, 'missing-autopilot') }],
    services: [],
  }
  try {
    const report = await observe(config)
    assert.ok(report.candidates.length > 0)
    const targetId = report.candidates[0].id
    const db = openBacklogDatabase(config)
    try {
      // Simulate 5 recurring cycles so this item is strong
      for (let i = 0; i < 5; i++) {
        mergeCandidatesIntoBacklog(db, report.candidates, new Date(Date.now() - (4 - i) * 60_000))
      }
    } finally {
      db.close()
    }
    const graph = await getIdeaGraph(config, report, [])
    const signalNode = graph.nodes.find((node) => node.source === `candidate:${targetId}`)
    assert.ok(signalNode)
    assert.equal(signalNode.confidence, 'strong')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('dismissed backlog items produce no signal node on the graph', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-dismiss-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [{ name: 'kevin-autopilot', path: join(dataDir, 'missing-autopilot') }],
    services: [],
  }
  try {
    const report = await observe(config)
    assert.ok(report.candidates.length > 0)
    const targetId = report.candidates[0].id
    const db = openBacklogDatabase(config)
    try {
      mergeCandidatesIntoBacklog(db, report.candidates, new Date())
      dismissBacklogItem(db, targetId, new Date())
    } finally {
      db.close()
    }
    const graph = await getIdeaGraph(config, report, [])
    assert.equal(graph.nodes.some((node) => node.source === `candidate:${targetId}`), false)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('snoozed backlog items disappear from graph until snooze expires', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-snooze-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [{ name: 'kevin-autopilot', path: join(dataDir, 'missing-autopilot') }],
    services: [],
  }
  try {
    const report = await observe(config)
    assert.ok(report.candidates.length > 0)
    const targetId = report.candidates[0].id
    const db = openBacklogDatabase(config)
    try {
      mergeCandidatesIntoBacklog(db, report.candidates, new Date())
      snoozeBacklogItem(db, targetId, 1, new Date())
    } finally {
      db.close()
    }
    const graph = await getIdeaGraph(config, report, [])
    assert.equal(graph.nodes.some((node) => node.source === `candidate:${targetId}`), false)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('idea graph removes legacy literal metaphor seed nodes on refresh', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-legacy-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    await writeFile(join(dataDir, 'idea-graph.json'), `${JSON.stringify({
      nodes: [
        {
          id: 'keyword-電子羊',
          type: 'keyword',
          title: '電子羊',
          summary: 'legacy literal keyword',
          source: 'keyword:電子羊',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          confidence: 'medium',
          safety: 'read-only',
          keywords: ['電子羊'],
          relatedProjectNames: [],
          thinking: {
            understanding: 'legacy',
            whyItMatters: 'legacy',
            nextExploration: 'legacy',
            evidence: [],
            missingEvidence: [],
          },
          actions: [],
        },
        {
          id: 'research-電子羊',
          type: 'research',
          title: '夢到電子羊：分身的半夢半醒聯想',
          summary: 'legacy literal research seed',
          source: 'deterministic-research-seed',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          confidence: 'weak',
          safety: 'read-only',
          keywords: ['電子羊'],
          relatedProjectNames: [],
          thinking: {
            understanding: 'legacy',
            whyItMatters: 'legacy',
            nextExploration: 'legacy',
            evidence: [],
            missingEvidence: [],
          },
          actions: [],
        },
      ],
      edges: [
        {
          id: 'contains_keyword-research-電子羊-keyword-電子羊',
          type: 'contains_keyword',
          from: 'research-電子羊',
          to: 'keyword-電子羊',
          rationale: 'legacy literal edge',
          confidence: 'weak',
          source: 'deterministic-research-seed',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }, null, 2)}\n`, 'utf8')

    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [])
    const persisted = await readFile(join(dataDir, 'idea-graph.json'), 'utf8')

    assert.equal(JSON.stringify(graph).includes('電子羊'), false)
    assert.equal(persisted.includes('電子羊'), false)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('legacy stored graph nodes without prompt receive safe prompts on refresh', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-legacy-prompt-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    await writeFile(join(dataDir, 'idea-graph.json'), `${JSON.stringify({
      nodes: [
        {
          id: 'extension-legacy-node',
          type: 'extension',
          title: 'Legacy extension without prompt',
          summary: 'Stored before v0.8.0 prompt synthesis.',
          source: 'extension:legacy',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          confidence: 'weak',
          safety: 'read-only',
          keywords: ['legacy', 'prompt'],
          relatedProjectNames: [],
          thinking: {
            understanding: 'legacy',
            whyItMatters: 'legacy',
            nextExploration: 'legacy',
            evidence: [],
            missingEvidence: [],
          },
          actions: [],
        },
      ],
      edges: [],
    }, null, 2)}\n`, 'utf8')

    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [])
    const legacy = graph.nodes.find((node) => node.id === 'extension-legacy-node')
    assert.ok(legacy)
    assert.match(legacy.prompt ?? '', /do not edit target repositories/i)
    assert.equal(legacy.actions.find((action) => action.id === 'copy-opencode-prompt')?.enabled, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

async function snapshotFiles(root: string, dir = root): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const [file, content] of await snapshotFiles(root, path)) snapshot.set(file, content)
      continue
    }
    if (!entry.isFile()) continue
    snapshot.set(relative(root, path).replace(/\\/g, '/'), await readFile(path, 'base64'))
  }
  return snapshot
}

function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const files = new Set([...before.keys(), ...after.keys()])
  return [...files].filter((file) => before.get(file) !== after.get(file)).sort()
}
