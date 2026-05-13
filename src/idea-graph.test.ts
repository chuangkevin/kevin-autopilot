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
  migrateExtensionDuplicates,
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
    assert.equal(graph.nodes.some((node) => node.type === 'keyword'), false)
    assert.equal(graph.edges.some((edge) => edge.type === 'extends' || edge.type === 'resembles_project'), true)

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

test('idea graph connects cached public web research findings', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-web-research-'))
  const originalFetch = globalThis.fetch
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    webResearch: { enabled: true, maxQueriesPerGraph: 1, cacheTtlMs: 60_000, timeoutMs: 1_000 },
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      Heading: 'Agent cockpit research',
      AbstractText: 'Agent cockpit systems help operators inspect autonomous agent plans and evidence.',
      AbstractURL: 'https://example.com/agent-cockpit',
      RelatedTopics: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    const idea = await createIdea(config, 'agent cockpit 要會自己研究和上網搜尋')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [idea])
    const ideaNode = graph.nodes.find((node) => node.type === 'idea' && node.source === `idea:${idea.id}`)
    const findingNode = graph.nodes.find((node) => node.type === 'research' && node.source.startsWith('web-research:'))

    assert.ok(ideaNode)
    assert.ok(findingNode)
    assert.match(findingNode.title, /網路發現/)
    assert.equal(findingNode.safety, 'read-only')
    assert.equal(findingNode.thinking.evidence.some((entry) => entry.includes('DuckDuckGo Instant Answer')), true)
    assert.equal(graph.edges.some((edge) => edge.from === ideaNode.id && edge.to === findingNode.id && edge.source.startsWith('web-research:')), true)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('idea graph adds outside-world discovery findings when web research is enabled', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-world-research-'))
  const originalFetch = globalThis.fetch
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    webResearch: { enabled: true, maxQueriesPerGraph: 1, cacheTtlMs: 60_000, timeoutMs: 1_000 },
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const requestedUrls: string[] = []
    globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(input))
      return new Response(JSON.stringify({
        Heading: 'Strange AI interface demo',
        AbstractText: 'A real outside-world demo that explores unusual AI agent interfaces.',
        AbstractURL: 'https://example.com/strange-ai-interface',
        RelatedTopics: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [])
    const findingNode = graph.nodes.find((node) => node.type === 'research' && node.source.startsWith('web-research:'))

    assert.equal(requestedUrls.some((url) => url.includes('AI%20agent%20interface%20experiments') || url.includes('AI+agent+interface+experiments')), true)
    assert.ok(findingNode)
    assert.match(findingNode.title, /世界發現/)
    assert.equal(findingNode.thinking.whyItMatters.includes('世界上有趣的事情'), true)
    assert.equal(graph.edges.some((edge) => edge.from === 'double-kevin-autopilot' && edge.to === findingNode.id), true)
  } finally {
    globalThis.fetch = originalFetch
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

test('visible graph excludes keyword vocabulary nodes and boring research seeds', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-suppress-keyword-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const idea = await createIdea(config, 'git docs work safe for homelab agent workflow cockpit')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [idea])

    assert.equal(graph.nodes.some((node) => node.type === 'keyword'), false)
    assert.equal(graph.nodes.some((node) => node.type === 'research' && node.keywords.some((keyword) => ['git', 'docs', 'work', 'safe', 'for', 'homelab', 'tests', 'handoff'].includes(keyword))), false)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('visible graph hides legacy noisy deterministic research nodes', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-legacy-noisy-research-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    await writeFile(join(dataDir, 'idea-graph.json'), JSON.stringify({
      nodes: [{
        id: 'research-tests',
        type: 'research',
        title: '想研究：tests',
        summary: 'legacy noisy node',
        source: 'deterministic-research-seed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: 'weak',
        safety: 'read-only',
        keywords: ['tests'],
        relatedProjectNames: [],
        thinking: { understanding: '', whyItMatters: '', nextExploration: '', evidence: [], missingEvidence: [] },
        actions: [],
      }],
      edges: [],
    }), 'utf8')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [])

    assert.equal(graph.nodes.some((node) => node.id === 'research-tests'), false)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('interesting idea feedback prioritizes related research nodes', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-interest-feedback-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const ideaA = await createIdea(config, 'agent lens')
    const ideaB = await createIdea(config, 'zebra lens')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [ideaA, ideaB])
    const zebraIdea = graph.nodes.find((node) => node.type === 'idea' && node.source === `idea:${ideaB.id}`)
    assert.ok(zebraIdea)

    await markIdeaGraphNodeInteresting(config, report, [ideaA, ideaB], zebraIdea.id)
    const refreshed = await getIdeaGraph(config, report, [ideaA, ideaB])
    const zebraResearchIndex = refreshed.nodes.findIndex((node) => node.id === 'research-zebra')
    const agentResearchIndex = refreshed.nodes.findIndex((node) => node.id === 'research-agent')

    assert.equal(zebraResearchIndex >= 0, true)
    assert.equal(agentResearchIndex >= 0, true)
    assert.equal(zebraResearchIndex < agentResearchIndex, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('interesting idea feedback spends limited web research on matching ideas', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-graph-web-feedback-'))
  const originalFetch = globalThis.fetch
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    webResearch: { enabled: true, maxQueriesPerGraph: 1, cacheTtlMs: 60_000, timeoutMs: 1_000 },
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const requestedUrls: string[] = []
    globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(input))
      return new Response(JSON.stringify({
        Heading: 'Research result',
        AbstractText: 'A bounded public research result.',
        AbstractURL: 'https://example.com/research',
        RelatedTopics: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const ideaA = await createIdea(config, 'agent cockpit reference')
    const ideaB = await createIdea(config, 'zebra workflow reference')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [ideaA, ideaB])
    const zebraIdea = graph.nodes.find((node) => node.type === 'idea' && node.source === `idea:${ideaB.id}`)
    assert.ok(zebraIdea)
    await markIdeaGraphNodeInteresting(config, report, [ideaA, ideaB], zebraIdea.id)

    requestedUrls.length = 0
    await getIdeaGraph(config, report, [ideaA, ideaB])

    assert.equal(requestedUrls.some((url) => url.includes('zebra')), true)
    assert.equal(requestedUrls.some((url) => url.includes('agent')), false)
  } finally {
    globalThis.fetch = originalFetch
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
    const legacy = graph.nodes.find((node) => node.type === 'extension' && node.source === 'extension:legacy')
    assert.ok(legacy)
    assert.match(legacy.id, /^extension-legacy-[0-9a-f]{6}$/)
    assert.match(legacy.prompt ?? '', /do not edit target repositories/i)
    assert.equal(legacy.actions.find((action) => action.id === 'copy-opencode-prompt')?.enabled, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('extension nodes use deterministic signature-based ids', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-extension-signature-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const idea = await createIdea(config, '想做 agent cockpit 並延伸出研究種子')
    const report = await observe(config)
    const first = await getIdeaGraph(config, report, [idea])
    const firstExtensionIds = first.nodes
      .filter((node) => node.type === 'extension' && node.source.startsWith(`idea-extension:${idea.id}:`))
      .map((node) => node.id)
      .sort()
    assert.equal(firstExtensionIds.length > 0, true)
    assert.equal(firstExtensionIds.every((id) => /^extension-idea-[a-z0-9-]+-[0-9a-f]{6}$/.test(id)), true)

    const second = await getIdeaGraph(config, report, [idea])
    const secondExtensionIds = second.nodes
      .filter((node) => node.type === 'extension' && node.source.startsWith(`idea-extension:${idea.id}:`))
      .map((node) => node.id)
      .sort()
    assert.deepEqual(secondExtensionIds, firstExtensionIds)
    const reloadedExtension = second.nodes.find((node) => node.id === firstExtensionIds[0])
    assert.ok(reloadedExtension)
    assert.equal((reloadedExtension.seenCount ?? 0) >= 2, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('extending a node twice upserts the same signature-based extension', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-extension-upsert-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const idea = await createIdea(config, 'agent cockpit extend test')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [idea])
    const ideaNode = graph.nodes.find((node) => node.type === 'idea')
    assert.ok(ideaNode)

    const firstExtend = await extendIdeaGraphNode(config, report, [idea], ideaNode.id)
    const secondExtend = await extendIdeaGraphNode(config, report, [idea], ideaNode.id)
    const thirdExtend = await extendIdeaGraphNode(config, report, [idea], ideaNode.id)
    assert.equal(firstExtend?.node.id, secondExtend?.node.id)
    assert.equal(firstExtend?.node.id, thirdExtend?.node.id)

    const refreshed = await getIdeaGraph(config, report, [idea])
    const onDemandExtensions = refreshed.nodes.filter((node) => node.type === 'extension' && node.source === `extension:${ideaNode.id}`)
    assert.equal(onDemandExtensions.length, 1)
    assert.equal((onDemandExtensions[0].seenCount ?? 0) >= 2, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('extending a node respects the per-parent extension cap', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-extension-cap-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    const idea = await createIdea(config, '想嘗試 agent cockpit 各種延伸方向')
    const report = await observe(config)
    const graph = await getIdeaGraph(config, report, [idea])
    const ideaNode = graph.nodes.find((node) => node.type === 'idea')
    assert.ok(ideaNode)

    const now = new Date().toISOString()
    const parentId = ideaNode.id
    const syntheticChildren = Array.from({ length: 6 }, (_, index) => ({
      id: `extension-${parentId}-synthetic${index}`,
      type: 'extension' as const,
      title: `延伸：分支線 ${index}`,
      summary: `合成測試節點 ${index}`,
      source: `extension:${parentId}`,
      createdAt: now,
      updatedAt: now,
      confidence: 'medium' as const,
      safety: 'read-only' as const,
      keywords: [`branch-${index}`],
      relatedProjectNames: [],
      thinking: {
        understanding: '',
        whyItMatters: '',
        nextExploration: '',
        evidence: [],
        missingEvidence: [],
      },
      actions: [],
    }))
    const existingRaw = JSON.parse(await readFile(join(dataDir, 'idea-graph.json'), 'utf8')) as { nodes: unknown[]; edges: unknown[] }
    const mergedNodes = [...existingRaw.nodes, ...syntheticChildren]
    const mergedEdges = [...existingRaw.edges, ...syntheticChildren.map((child) => ({
      id: `extends-${parentId}-${child.id}`,
      type: 'extends' as const,
      from: parentId,
      to: child.id,
      rationale: 'synthetic edge for cap test',
      confidence: 'medium' as const,
      source: `extension:${parentId}`,
      createdAt: now,
      updatedAt: now,
    }))]
    await writeFile(join(dataDir, 'idea-graph.json'), JSON.stringify({ nodes: mergedNodes, edges: mergedEdges }), 'utf8')

    const result = await extendIdeaGraphNode(config, report, [idea], ideaNode.id)
    assert.ok(result)
    const after = await getIdeaGraph(config, report, [idea])
    const childExtensions = after.nodes.filter((node) => node.type === 'extension' && node.source === `extension:${parentId}`)
    assert.equal(childExtensions.length, 6)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('migrateExtensionDuplicates keeps distinct legacy extensions distinct', () => {
  const baseTimestamp = '2026-04-01T00:00:00.000Z'
  const legacy = {
    nodes: [
      {
        id: 'extension-test-parent-1',
        type: 'extension',
        title: '延伸：第一條探索線',
        summary: 'legacy first',
        source: 'idea-extension:test-parent:1',
        createdAt: baseTimestamp,
        updatedAt: baseTimestamp,
        confidence: 'medium',
        safety: 'read-only',
        keywords: ['agent', 'cockpit'],
        relatedProjectNames: [],
        thinking: { understanding: '', whyItMatters: '', nextExploration: '', evidence: [], missingEvidence: [] },
        actions: [],
      },
      {
        id: 'extension-test-parent-2',
        type: 'extension',
        title: '延伸：第二條完全不同的方向',
        summary: 'legacy second',
        source: 'idea-extension:test-parent:2',
        createdAt: baseTimestamp,
        updatedAt: baseTimestamp,
        confidence: 'medium',
        safety: 'read-only',
        keywords: ['research', 'prototype'],
        relatedProjectNames: [],
        thinking: { understanding: '', whyItMatters: '', nextExploration: '', evidence: [], missingEvidence: [] },
        actions: [],
      },
    ],
    edges: [
      {
        id: 'extends-idea-test-parent-extension-test-parent-1',
        type: 'extends',
        from: 'idea-test-parent',
        to: 'extension-test-parent-1',
        rationale: 'legacy edge 1',
        confidence: 'medium',
        source: 'idea-extension:test-parent:1',
        createdAt: baseTimestamp,
        updatedAt: baseTimestamp,
      },
      {
        id: 'extends-idea-test-parent-extension-test-parent-2',
        type: 'extends',
        from: 'idea-test-parent',
        to: 'extension-test-parent-2',
        rationale: 'legacy edge 2',
        confidence: 'medium',
        source: 'idea-extension:test-parent:2',
        createdAt: baseTimestamp,
        updatedAt: baseTimestamp,
      },
    ],
  }

  const migrated = migrateExtensionDuplicates(legacy as never)
  const extensions = migrated.nodes.filter((node) => node.type === 'extension')
  assert.equal(extensions.length, 2, 'different titles produce different canonical ids and remain separate')
  for (const extension of extensions) {
    assert.match(extension.id, /^extension-[a-z0-9-]+-[0-9a-f]{6}$/)
  }
  for (const edge of migrated.edges) {
    assert.equal(migrated.nodes.some((node) => node.id === edge.to) || edge.to === 'idea-test-parent', true)
  }
})

test('migrateExtensionDuplicates merges true duplicates with the same canonical id', () => {
  const baseTimestamp = '2026-04-01T00:00:00.000Z'
  const laterTimestamp = '2026-04-02T00:00:00.000Z'
  const sharedTitle = '延伸：完全相同的標題'
  const sharedKeywords = ['agent', 'cockpit']
  const parent = 'idea-shared-parent'
  const legacy = {
    nodes: [
      {
        id: `extension-${parent}-1`,
        type: 'extension',
        title: sharedTitle,
        summary: 'oldest',
        source: 'idea-extension:shared-parent:1',
        createdAt: baseTimestamp,
        updatedAt: baseTimestamp,
        confidence: 'medium',
        safety: 'read-only',
        keywords: sharedKeywords,
        relatedProjectNames: [],
        thinking: { understanding: '', whyItMatters: '', nextExploration: '', evidence: [], missingEvidence: [] },
        actions: [],
      },
      {
        id: `extension-${parent}-1700000000000`,
        type: 'extension',
        title: sharedTitle,
        summary: 'newer dup',
        source: 'idea-extension:shared-parent:1',
        createdAt: laterTimestamp,
        updatedAt: laterTimestamp,
        confidence: 'medium',
        safety: 'read-only',
        keywords: sharedKeywords,
        relatedProjectNames: [],
        thinking: { understanding: '', whyItMatters: '', nextExploration: '', evidence: [], missingEvidence: [] },
        actions: [],
      },
    ],
    edges: [
      {
        id: 'edge-old',
        type: 'extends',
        from: 'someone-else',
        to: `extension-${parent}-1`,
        rationale: 'older',
        confidence: 'medium',
        source: 'idea-extension:shared-parent:1',
        createdAt: baseTimestamp,
        updatedAt: baseTimestamp,
      },
      {
        id: 'edge-new',
        type: 'extends',
        from: 'someone-else',
        to: `extension-${parent}-1700000000000`,
        rationale: 'newer',
        confidence: 'medium',
        source: 'idea-extension:shared-parent:1',
        createdAt: laterTimestamp,
        updatedAt: laterTimestamp,
      },
    ],
  }

  const migrated = migrateExtensionDuplicates(legacy as never)
  const extensions = migrated.nodes.filter((node) => node.type === 'extension')
  assert.equal(extensions.length, 1)
  assert.equal(extensions[0].summary, 'oldest', 'winner is the older createdAt')
  for (const edge of migrated.edges) {
    assert.equal(edge.to, extensions[0].id, 'every edge endpoint points at the surviving canonical id')
    assert.equal(migrated.nodes.some((node) => node.id === edge.from) || edge.from === 'someone-else', true)
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
