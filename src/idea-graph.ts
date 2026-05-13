import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { effectiveStatus, listBacklog, openBacklogDatabase } from './backlog.js'
import { refreshWebResearch, type WebResearchFinding, type WebResearchSeed } from './web-research.js'
import type {
  AutopilotConfig,
  BacklogItem,
  BacklogStrength,
  IdeaGraph,
  IdeaGraphAction,
  IdeaGraphConfidence,
  IdeaGraphEdge,
  IdeaGraphEdgeType,
  IdeaGraphNode,
  IdeaGraphNodeDetail,
  IdeaGraphNodeType,
  IdeaRecord,
  ObservationCandidate,
  ObservationCandidateConfidence,
  ObservationReport,
} from './types.js'

const GRAPH_FILE = 'idea-graph.json'
const CENTER_NODE_ID = 'double-kevin-autopilot'
const EXTENSION_PARENT_CAP = 6
const EXTENSION_TITLE_PREFIX = /^延伸：/
const STOP_WORDS = new Set(['我要', '可以', '現在', '這個', '那個', '一個', '不是', '就是', '沒有', '什麼', 'the', 'and', 'with', 'that', 'for', 'safe'])
const BORING_RESEARCH_KEYWORDS = new Set(['autopilot', 'docs', 'doc', 'work', 'homelab', 'uncommitted', 'kevin', 'repo', 'git', 'test', 'tests', 'handoff'])
const LEGACY_LITERAL_METAPHOR_PATTERN = /電子羊|electric sheep/i
const WORLD_DISCOVERY_SEEDS: Array<{ id: string, title: string, keywords: string[] }> = [
  { id: 'agent-interface-experiments', title: '世界線索：AI agent interface experiments', keywords: ['ai', 'agent', 'interface', 'experiments'] },
  { id: 'weird-personal-knowledge-tools', title: '世界線索：weird personal knowledge tools', keywords: ['personal', 'knowledge', 'tools', 'weird'] },
  { id: 'research-workflow-cockpits', title: '世界線索：research workflow cockpits', keywords: ['research', 'workflow', 'cockpit', 'tools'] },
  { id: 'calm-computing-prototypes', title: '世界線索：calm computing prototypes', keywords: ['calm', 'computing', 'prototype', 'ambient'] },
]

interface StoredIdeaGraph {
  nodes: IdeaGraphNode[]
  edges: IdeaGraphEdge[]
}

interface GraphFeedbackProfile {
  keywords: Set<string>
  projectNames: Set<string>
}

export async function getIdeaGraph(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[]): Promise<IdeaGraph> {
  const stored = await loadStoredGraph(config)
  const backlogLookup = loadBacklogLookup(config)
  const suppressedKeywords = suppressedKeywordSet(stored)
  const feedback = graphFeedbackProfile(stored)
  const webFindings = await refreshWebResearch(config, makeWebResearchSeeds(ideas, suppressedKeywords, feedback))
  const graph = mergeGraph(stored, createProjectedGraph(config, report, ideas, backlogLookup, webFindings, suppressedKeywords))
  await saveStoredGraph(config, graph)
  return toFocusedGraph(graph, report)
}

export async function getIdeaGraphNodeDetail(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[], nodeId: string): Promise<IdeaGraphNodeDetail | undefined> {
  const graph = await getIdeaGraph(config, report, ideas)
  return selectGraphNode(graph, nodeId)
}

export async function extendIdeaGraphNode(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[], nodeId: string): Promise<IdeaGraphNodeDetail | undefined> {
  const stored = await loadStoredGraph(config)
  const backlogLookup = loadBacklogLookup(config)
  const graph = mergeGraph(stored, createProjectedGraph(config, report, ideas, backlogLookup))
  const selected = graph.nodes.find((node) => node.id === nodeId)
  if (!selected) return undefined

  const now = new Date().toISOString()
  const extensionKeywords = selected.keywords.slice(0, 6)
  const extensionTitle = `延伸：${selected.title}`
  const proposedId = extensionId(selected.id, extensionTitle, extensionKeywords)

  const childExtensions = graph.nodes.filter((node) => node.type === 'extension' && node.source === `extension:${selected.id}`)
  const matchingChild = childExtensions.find((node) => node.id === proposedId)
  let targetExtensionId = proposedId

  if (!matchingChild && childExtensions.length >= EXTENSION_PARENT_CAP) {
    const fallback = pickClosestExtensionByKeywords(childExtensions, extensionKeywords)
      ?? [...childExtensions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (!fallback) return undefined
    targetExtensionId = fallback.id
  }

  const baseExtensionNode = makeNode({
    id: targetExtensionId,
    type: 'extension',
    title: extensionTitle,
    summary: `從「${selected.title}」再長出一條可探索方向。`,
    source: `extension:${selected.id}`,
    confidence: selected.confidence === 'strong' ? 'medium' : selected.confidence,
    keywords: extensionKeywords,
    relatedProjectNames: selected.relatedProjectNames,
    now,
    thinking: {
      understanding: `我把「${selected.title}」當成一個可繼續想像的節點，而不是立刻要做的任務。`,
      whyItMatters: 'Kevin 想快速看到關鍵字、關聯和延伸；這個節點先保存分身的新聯想。',
      nextExploration: '下一輪可以找更多關聯，或把它收斂成 research seed / prototype / OpenCode prompt。',
      evidence: [`來源節點：${selected.title}`, `節點類型：${selected.type}`],
      missingEvidence: ['還沒有外部研究來源；目前只是 Autopilot-owned 延伸節點。'],
    },
  })
  const extensionNode: IdeaGraphNode = { ...baseExtensionNode, seenCount: 1, lastSeenAt: now }
  const researchNode = makeNode({
    id: `research-${safeId(selected.id)}-${stableHash6(`research:${selected.id}:${selected.keywords[0] ?? selected.title}`)}`,
    type: 'research',
    title: `研究種子：${selected.keywords[0] ?? selected.title}`,
    summary: '這是待搜尋/待研究的方向；可能只是分身做夢般的聯想，不代表已經查過網路。',
    source: `research-seed:${selected.id}`,
    confidence: 'weak',
    keywords: selected.keywords.slice(0, 6),
    relatedProjectNames: selected.relatedProjectNames,
    now,
    thinking: {
      understanding: '這個研究節點是分身想查的新方向。',
      whyItMatters: 'Kevin 常常只是想打開來看有沒有可取的新想法，所以先把可研究問題留在圖上。',
      nextExploration: `之後可搜尋：${selected.keywords.slice(0, 3).join(' ') || selected.title}`,
      evidence: ['由本機 graph extension 產生，未宣稱已搜尋 public web。'],
      missingEvidence: ['需要設定 approved web source 後才可變成 fetched finding。'],
    },
  })
  const nextGraph = mergeGraph(graph, {
    nodes: [extensionNode, researchNode],
    edges: [
      makeEdge(selected.id, extensionNode.id, 'extends', '從選取節點延伸出的新想法。', 'medium', `extension:${selected.id}`, now),
      makeEdge(extensionNode.id, researchNode.id, 'can_research', '延伸想法可以變成研究種子。', 'weak', `extension:${selected.id}`, now),
    ],
  })
  await saveStoredGraph(config, nextGraph)
  return selectGraphNode({ ...toFocusedGraph(nextGraph, report), nodes: nextGraph.nodes, edges: nextGraph.edges }, extensionNode.id)
}

function pickClosestExtensionByKeywords(candidates: IdeaGraphNode[], keywords: string[]): IdeaGraphNode | undefined {
  if (candidates.length === 0 || keywords.length === 0) return undefined
  const target = new Set(keywords.map((keyword) => keyword.toLowerCase()))
  let best: { node: IdeaGraphNode; score: number } | undefined
  for (const node of candidates) {
    const nodeKeywords = new Set(node.keywords.map((keyword) => keyword.toLowerCase()))
    const intersection = [...target].filter((keyword) => nodeKeywords.has(keyword)).length
    const union = new Set([...target, ...nodeKeywords]).size
    const score = union === 0 ? 0 : intersection / union
    if (score >= 0.5 && (!best || score > best.score)) best = { node, score }
  }
  return best?.node
}

export async function markIdeaGraphNodeInteresting(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[], nodeId: string): Promise<IdeaGraphNodeDetail | undefined> {
  const stored = await loadStoredGraph(config)
  const backlogLookup = loadBacklogLookup(config)
  const graph = mergeGraph(stored, createProjectedGraph(config, report, ideas, backlogLookup))
  const now = new Date().toISOString()
  let found = false
  const nextGraph: StoredIdeaGraph = {
    nodes: graph.nodes.map((node) => {
      if (node.id !== nodeId) return node
      found = true
      const nextNode: IdeaGraphNode = {
        ...node,
        interesting: true,
        interestingAt: node.interestingAt ?? now,
        updatedAt: now,
      }
      return normalizeNodeActions(nextNode)
    }),
    edges: graph.edges,
  }
  if (!found) return undefined
  await saveStoredGraph(config, nextGraph)
  return selectGraphNode({ ...toFocusedGraph(nextGraph, report), nodes: nextGraph.nodes, edges: nextGraph.edges }, nodeId)
}

export async function findIdeaGraphNodeRelationships(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[], nodeId: string): Promise<IdeaGraphNodeDetail | undefined> {
  const stored = await loadStoredGraph(config)
  const backlogLookup = loadBacklogLookup(config)
  const graph = mergeGraph(stored, createProjectedGraph(config, report, ideas, backlogLookup))
  const selected = graph.nodes.find((node) => node.id === nodeId)
  if (!selected) return undefined
  const now = new Date().toISOString()
  const relationships = graph.nodes
    .filter((node) => node.id !== selected.id && !node.ignored && !node.archived)
    .map((node) => ({ node, score: relationshipScore(selected, node) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.node.updatedAt.localeCompare(a.node.updatedAt))
    .slice(0, 6)
  const edges = relationships.map(({ node, score }) => makeEdge(
    selected.id,
    node.id,
    sharedKeywords(selected, node).length > 0 ? 'contains_keyword' : 'resembles_project',
    relationshipRationale(selected, node),
    score >= 3 ? 'medium' : 'weak',
    `relationship:${selected.id}`,
    now,
  ))
  const nextGraph = mergeGraph(graph, { nodes: [], edges })
  await saveStoredGraph(config, nextGraph)
  return selectGraphNode({ ...toFocusedGraph(nextGraph, report), nodes: nextGraph.nodes, edges: nextGraph.edges }, nodeId)
}

export async function stopExploringIdeaGraphNode(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[], nodeId: string): Promise<IdeaGraphNodeDetail | undefined> {
  const stored = await loadStoredGraph(config)
  const backlogLookup = loadBacklogLookup(config)
  const graph = mergeGraph(stored, createProjectedGraph(config, report, ideas, backlogLookup))
  const selected = graph.nodes.find((node) => node.id === nodeId)
  if (!selected || selected.type === 'double') return undefined
  const suppressedKeywords = selected.type === 'keyword' ? new Set(selected.keywords.map((keyword) => keyword.toLowerCase())) : new Set<string>()
  const now = new Date().toISOString()
  let hidden: IdeaGraphNode | undefined
  const nextGraph: StoredIdeaGraph = {
    nodes: graph.nodes.map((node) => {
      const shouldHideRelatedKeywordNode = suppressedKeywords.size > 0
        && (node.type === 'keyword' || node.type === 'research')
        && (node.keywords.some((keyword) => isSuppressedKeyword(keyword, suppressedKeywords)) || hasSuppressedKeyword(node.title, suppressedKeywords))
      if (node.id !== nodeId && !shouldHideRelatedKeywordNode) return node
      const ignored = normalizeNodeActions({ ...node, ignored: true, updatedAt: now })
      if (node.id === nodeId) hidden = ignored
      return ignored
    }),
    edges: graph.edges,
  }
  if (!hidden) return undefined
  await saveStoredGraph(config, nextGraph)
  return selectGraphNode({ ...toFocusedGraph(nextGraph, report), nodes: nextGraph.nodes, edges: nextGraph.edges }, nodeId)
}

export function selectGraphNode(graph: IdeaGraph, nodeId: string): IdeaGraphNodeDetail | undefined {
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (!node) return undefined
  const edges = graph.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId)
  const connectedIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]).filter((id) => id !== nodeId))
  return {
    node,
    edges,
    connectedNodes: graph.nodes.filter((item) => connectedIds.has(item.id)),
  }
}

export function extractIdeaKeywords(value: string, limit = 8): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/https?:\/\//g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  return [...new Set(tokens)].slice(0, limit)
}

function createProjectedGraph(
  config: AutopilotConfig,
  report: ObservationReport,
  ideas: IdeaRecord[],
  backlogLookup: Map<string, BacklogItem> = new Map(),
  webFindings: WebResearchFinding[] = [],
  suppressedKeywords: Set<string> = new Set(),
): StoredIdeaGraph {
  const now = new Date().toISOString()
  const nowDate = new Date(now)
  const nodes: IdeaGraphNode[] = [makeCenterNode(report, ideas, now)]
  const edges: IdeaGraphEdge[] = []

  for (const repo of config.repositories) {
    const observed = report.repositories.find((item) => item.name === repo.name)
    const projectNode = makeNode({
      id: `project-${safeId(repo.name)}`,
      type: 'project',
      title: repo.name,
      summary: observed?.exists === false ? '設定中的專案目前找不到路徑。' : observed?.dirty ? '專案有未提交變更，分身會把它當成觀察訊號。' : '設定中的既有專案。',
      source: `repository:${repo.name}`,
      confidence: observed?.exists === false || observed?.dirty ? 'medium' : 'weak',
      keywords: extractIdeaKeywords(`${repo.name} ${repo.path}`),
      relatedProjectNames: [repo.name],
      now,
      thinking: {
        understanding: `這是 Kevin 既有專案「${repo.name}」，新想法會拿它來比對是否該整合。`,
        whyItMatters: 'Kevin 不想每個新想法都開新 repo；分身要先看能不能接到既有專案。',
        nextExploration: observed?.dirty ? '先確認 dirty 變更是不是 Kevin 正在做的工作。' : '用作想法整合的錨點。',
        evidence: [`repo path: ${repo.path}`, observed?.branch ? `branch: ${observed.branch}` : '尚無 branch 訊號'],
        missingEvidence: observed?.exists === false ? ['需要確認 repo path 是否過期。'] : [],
      },
    })
    nodes.push(projectNode)
    edges.push(makeEdge(CENTER_NODE_ID, projectNode.id, 'observed_in', '分身會把既有專案當成腦圖錨點。', 'medium', 'configured-repository', now))
  }

  for (const idea of ideas) {
    const keywords = filterSuppressedKeywords(extractIdeaKeywords(idea.rawText), suppressedKeywords)
    const ideaNode = makeNode({
      id: `idea-${safeId(idea.id)}`,
      type: 'idea',
      title: idea.title,
      summary: idea.rawText.length > 180 ? `${idea.rawText.slice(0, 177)}...` : idea.rawText,
      source: `idea:${idea.id}`,
      confidence: idea.classification === 'blocked' ? 'weak' : idea.classification === 'prototype' || idea.classification === 'plan' ? 'medium' : 'weak',
      keywords,
      relatedProjectNames: idea.existingProjectAnalysis.matches.map((match) => match.projectName),
      now: idea.createdAt,
      thinking: {
        understanding: `我把這段文字理解成「${idea.title}」。`,
        whyItMatters: idea.existingProjectAnalysis.summary,
        nextExploration: idea.suggestedNextSteps[0] ?? '先找關鍵字與既有專案的關聯。',
        evidence: idea.reasons,
        missingEvidence: idea.classification === 'explore' ? ['還需要更多使用情境或成功條件。'] : [],
      },
      prompt: idea.projectHandoff?.boundedPrompt,
    })
    nodes.push(ideaNode)
    edges.push(makeEdge(CENTER_NODE_ID, ideaNode.id, 'extends', 'Kevin 的想法進入分身腦圖。', 'medium', `idea:${idea.id}`, idea.createdAt))

    for (const extensionNode of makeIdeaExtensionNodes(idea, keywords, idea.createdAt).slice(0, 2)) {
      nodes.push(extensionNode)
      edges.push(makeEdge(ideaNode.id, extensionNode.id, 'extends', '分身依照這個想法自動長出的下一層探索節點。', 'medium', `idea-extension:${idea.id}`, idea.createdAt))
      for (const keyword of extensionNode.keywords.slice(0, 2)) {
        edges.push(makeEdge(extensionNode.id, `keyword-${safeId(keyword)}`, 'contains_keyword', `延伸節點保留關鍵字「${keyword}」。`, 'weak', `idea-extension:${idea.id}`, idea.createdAt))
      }
    }

    for (const keyword of keywords.slice(0, 5)) {
      const keywordNode = makeKeywordNode(keyword, now)
      nodes.push(keywordNode)
      edges.push(makeEdge(ideaNode.id, keywordNode.id, 'contains_keyword', `想法包含關鍵字「${keyword}」。`, 'medium', `idea:${idea.id}`, idea.createdAt))
    }
    for (const match of idea.existingProjectAnalysis.matches) {
      edges.push(makeEdge(ideaNode.id, `project-${safeId(match.projectName)}`, 'resembles_project', match.reason, match.score >= 55 ? 'strong' : 'medium', `idea:${idea.id}`, idea.createdAt))
    }
  }

  for (const candidate of report.candidates.slice(0, 18)) {
    const backlogItem = backlogLookup.get(candidate.id)
    if (backlogItem && effectiveStatus(backlogItem, nowDate) !== 'active') continue
    const strength = backlogItem ? backlogItem.strength : candidateStrength(candidate.confidence)
    const signalNode = makeSignalNode(candidate, now, strength)
    nodes.push(signalNode)
    edges.push(makeEdge(CENTER_NODE_ID, signalNode.id, candidate.confidence === 'suspected' ? 'needs_evidence' : 'observed_in', candidate.evidence[0] ?? 'read-only observation signal', strength, `candidate:${candidate.id}`, now))
    const projectId = `project-${safeId(candidate.sourceName)}`
    if (nodes.some((node) => node.id === projectId)) {
      edges.push(makeEdge(signalNode.id, projectId, 'observed_in', `訊號來自 ${candidate.sourceName}。`, 'medium', `candidate:${candidate.id}`, now))
    }
    if (candidate.boundedPrompt) {
      const taskNode = makeTaskNode(candidate, now)
      nodes.push(taskNode)
      edges.push(makeEdge(signalNode.id, taskNode.id, 'can_become_task', '這個訊號可以被整理成 bounded OpenCode prompt。', strength === 'strong' ? 'medium' : 'weak', `candidate:${candidate.id}`, now))
    }
  }

  for (const keyword of recurrentKeywords(ideas, report)
    .filter((keyword) => !isSuppressedKeyword(keyword, suppressedKeywords) && isResearchWorthyKeyword(keyword))
    .slice(0, 4)) {
    nodes.push(makeKeywordNode(keyword, now))
    const research = makeResearchSeed(keyword, now)
    nodes.push(research)
    edges.push(makeEdge(CENTER_NODE_ID, research.id, 'can_research', `分身想找世界上跟「${keyword}」有關的有趣案例。`, 'weak', 'deterministic-research-seed', now))
    edges.push(makeEdge(research.id, `keyword-${safeId(keyword)}`, 'contains_keyword', `研究種子連到關鍵字「${keyword}」。`, 'weak', 'deterministic-research-seed', now))
  }

  for (const finding of webFindings.filter((finding) => !hasSuppressedKeyword(`${finding.title} ${finding.summary}`, suppressedKeywords) && !finding.keywords.some((keyword) => isSuppressedKeyword(keyword, suppressedKeywords))).slice(0, 10)) {
    const findingNode = makeWebFindingNode(finding)
    nodes.push(findingNode)
    if (nodes.some((node) => node.id === finding.seedNodeId)) {
      edges.push(makeEdge(finding.seedNodeId, findingNode.id, 'can_research', '分身已用公開網路查詢補了一個 research finding。', 'medium', `web-research:${finding.id}`, finding.fetchedAt))
    }
    for (const keyword of finding.keywords.slice(0, 2)) {
      nodes.push(makeKeywordNode(keyword, finding.fetchedAt))
      edges.push(makeEdge(findingNode.id, `keyword-${safeId(keyword)}`, 'contains_keyword', `網路 finding 提到「${keyword}」。`, 'weak', `web-research:${finding.id}`, finding.fetchedAt))
    }
  }

  return { nodes, edges }
}

function makeWebResearchSeeds(ideas: IdeaRecord[], suppressedKeywords: Set<string>, feedback: GraphFeedbackProfile): WebResearchSeed[] {
  const ideaSeeds = ideas
    .filter((idea) => !hasSuppressedKeyword(idea.rawText, suppressedKeywords))
    .sort((a, b) => ideaFeedbackScore(b, feedback) - ideaFeedbackScore(a, feedback))
    .slice(0, 8)
    .map((idea) => ({
      id: idea.id,
      nodeId: `idea-${safeId(idea.id)}`,
      title: idea.title,
      keywords: filterSuppressedKeywords(extractIdeaKeywords(idea.rawText), suppressedKeywords),
    }))
  return [...ideaSeeds, ...makeWorldDiscoverySeeds(suppressedKeywords)]
}

function makeWorldDiscoverySeeds(suppressedKeywords: Set<string>): WebResearchSeed[] {
  return WORLD_DISCOVERY_SEEDS
    .filter((seed) => !hasSuppressedKeyword(`${seed.title} ${seed.keywords.join(' ')}`, suppressedKeywords))
    .map((seed) => ({
      id: `world-${seed.id}`,
      nodeId: CENTER_NODE_ID,
      title: seed.title,
      keywords: seed.keywords,
    }))
}

function makeCenterNode(report: ObservationReport, ideas: IdeaRecord[], now: string): IdeaGraphNode {
  return makeNode({
    id: CENTER_NODE_ID,
    type: 'double',
    title: 'Kevin Autopilot',
    summary: '我在把你的想法、專案訊號、研究種子接成一張可以探索的分身腦圖。',
    source: 'system:double',
    confidence: 'strong',
    keywords: ['分身', '想法', '專案', '研究', 'OpenCode'],
    relatedProjectNames: report.projectRadar.slice(0, 4).map((project) => project.name),
    now,
    thinking: {
      understanding: 'Kevin 要的不是傳統 dashboard，而是能看見分身正在聯想什麼的神經網路。',
      whyItMatters: '想法爆炸時，分身要先抓關鍵字、找關聯、延伸方向，再收斂成可交給 OpenCode 的工作。',
      nextExploration: ideas.length > 0 ? '從最近的想法和專案訊號延伸更多節點。' : '先從專案觀察和研究種子長出第一批節點。',
      evidence: [`目前 idea ${ideas.length} 則`, `觀察候選 ${report.candidates.length} 個`, `專案雷達 ${report.projectRadar.length} 個`],
      missingEvidence: [],
    },
  })
}

function makeKeywordNode(keyword: string, now: string): IdeaGraphNode {
  return makeNode({
    id: `keyword-${safeId(keyword)}`,
    type: 'keyword',
    title: keyword,
    summary: `分身從想法或觀察中抓到的關鍵字：「${keyword}」。`,
    source: `keyword:${keyword}`,
    confidence: 'medium',
    keywords: [keyword],
    relatedProjectNames: [],
    now,
    thinking: {
      understanding: `「${keyword}」是一個可延伸的語意錨點。`,
      whyItMatters: 'Kevin 想快速看到關鍵字，從關鍵字再發散到研究、專案、任務。',
      nextExploration: `找更多跟「${keyword}」有關的想法與專案。`,
      evidence: ['由本機文字斷詞抽出。'],
      missingEvidence: [],
    },
  })
}

function makeSignalNode(candidate: ObservationCandidate, now: string, strength: BacklogStrength): IdeaGraphNode {
  const keywords = extractIdeaKeywords(`${candidate.title} ${candidate.suggestedNextStep} ${candidate.evidence.join(' ')}`)
  return makeNode({
    id: `signal-${safeId(candidate.id)}`,
    type: 'signal',
    title: candidate.title,
    summary: candidate.suggestedNextStep,
    source: `candidate:${candidate.id}`,
    confidence: strength,
    keywords,
    relatedProjectNames: [candidate.sourceName],
    now,
    thinking: {
      understanding: `這是一個 ${candidate.category} 訊號，來源是 ${candidate.sourceName}。`,
      whyItMatters: candidate.expectedBehavior,
      nextExploration: candidate.confidence === 'suspected' ? '先補證據，不要把弱訊號包成實作任務。' : candidate.suggestedNextStep,
      evidence: candidate.evidence,
      missingEvidence: candidate.confidence === 'suspected' ? [candidate.actualBehavior] : [],
    },
    prompt: candidate.boundedPrompt,
  })
}

function candidateStrength(confidence: ObservationCandidateConfidence): BacklogStrength {
  if (confidence === 'confirmed') return 'strong'
  if (confidence === 'likely') return 'medium'
  return 'weak'
}

function loadBacklogLookup(config: AutopilotConfig): Map<string, BacklogItem> {
  const db = openBacklogDatabase(config)
  try {
    const items = listBacklog(db, 'all', new Date())
    return new Map(items.map((item) => [item.id, item]))
  } finally {
    db.close()
  }
}

function makeTaskNode(candidate: ObservationCandidate, now: string): IdeaGraphNode {
  return makeNode({
    id: `task-${safeId(candidate.id)}`,
    type: 'task',
    title: `OpenCode：${candidate.title}`,
    summary: candidate.suggestedNextStep,
    source: `candidate-task:${candidate.id}`,
    confidence: candidate.confidence === 'confirmed' ? 'strong' : 'medium',
    keywords: extractIdeaKeywords(candidate.title),
    relatedProjectNames: [candidate.sourceName],
    now,
    thinking: {
      understanding: '這是可複製給 OpenCode 的 bounded prompt 產物，不是 Autopilot 自己執行。',
      whyItMatters: '把可操作工作變成安全 handoff，避免分身亂改 repo。',
      nextExploration: candidate.approvalRequired ? '先取得 Kevin approval，再交給 OpenCode。' : '可以複製 prompt 給 OpenCode 做 read-only 釐清。',
      evidence: candidate.evidence,
      missingEvidence: candidate.approvalRequired ? ['需要 Kevin 明確批准。'] : [],
    },
    prompt: candidate.boundedPrompt,
  })
}

function makeResearchSeed(keyword: string, now: string): IdeaGraphNode {
  return makeNode({
    id: `research-${safeId(keyword)}`,
    type: 'research',
    title: `世界線索：${keyword}`,
    summary: `找一個世界上正在發生、能讓 Kevin 產生新想法的「${keyword}」案例；不是背單字，也不是 repo token。`,
    source: 'deterministic-research-seed',
    confidence: 'weak',
    keywords: [keyword],
    relatedProjectNames: [],
    now,
    thinking: {
      understanding: `我把「${keyword}」當成一個通往外部世界案例的入口，而不是要 Kevin 記住的詞。`,
      whyItMatters: 'Kevin 要的是世界上有趣的事情和可偷學的模式，不是一堆英文碎詞。',
      nextExploration: `找 ${keyword} 相關的真實產品、研究、怪案例或反直覺用法。`,
      evidence: ['由既有 ideas / observation keywords 產生。'],
      missingEvidence: ['尚未進行 public web search。'],
    },
  })
}

function makeWebFindingNode(finding: WebResearchFinding): IdeaGraphNode {
  const isWorldDiscovery = finding.seedId.startsWith('world-')
  return makeNode({
    id: `research-${safeId(finding.id)}`,
    type: 'research',
    title: `${isWorldDiscovery ? '世界發現' : '網路發現'}：${finding.title}`,
    summary: finding.summary.length > 220 ? `${finding.summary.slice(0, 217)}...` : finding.summary,
    source: `web-research:${finding.id}`,
    confidence: finding.url ? 'medium' : 'weak',
    keywords: finding.keywords,
    relatedProjectNames: [],
    now: finding.fetchedAt,
    thinking: {
      understanding: `這是分身針對「${finding.query}」做的公開網路 read-only 查詢摘要。`,
      whyItMatters: isWorldDiscovery ? 'Kevin 要的是世界上有趣的事情：真實產品、研究、怪案例、可偷學的互動模式。' : 'Kevin 要的分身不能只順著話長節點，也要補外部線索，讓想法有可查證的研究素材。',
      nextExploration: finding.url ? `打開來源確認內容是否真的適合 Kevin：${finding.url}` : '換更具體的關鍵字重新搜尋。',
      evidence: [`查詢：${finding.query}`, `來源：${finding.sourceName}`, finding.url ? `URL: ${finding.url}` : '搜尋 API 未回傳可引用 URL'],
      missingEvidence: finding.url ? [] : ['需要更具體查詢或其他 approved web source。'],
    },
  })
}

function makeNode(input: {
  id: string
  type: IdeaGraphNodeType
  title: string
  summary: string
  source: string
  confidence: IdeaGraphConfidence
  keywords: string[]
  relatedProjectNames: string[]
  now: string
  thinking: IdeaGraphNode['thinking']
  prompt?: string
}): IdeaGraphNode {
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    summary: input.summary,
    source: input.source,
    createdAt: input.now,
    updatedAt: input.now,
    confidence: input.confidence,
    safety: 'read-only',
    keywords: input.keywords,
    relatedProjectNames: input.relatedProjectNames,
    thinking: input.thinking,
    actions: makeActions(input.type, true, input.confidence),
    prompt: input.prompt ?? makeNodePrompt(input),
  }
}

function makeIdeaExtensionNodes(idea: IdeaRecord, keywords: string[], now: string): IdeaGraphNode[] {
  const firstStep = idea.suggestedNextSteps[0] ?? '先把這個想法拆成可探索的問題與成功條件。'
  const steps = [firstStep, creativeExplorationStep(idea, keywords)]
  const parentId = `idea-${safeId(idea.id)}`
  const generated = steps.map((step, index) => {
    const title = `延伸：${shortTitle(step)}`
    const extensionKeywords = extractIdeaKeywords(`${idea.title} ${step}`)
      .filter((keyword) => keywords.includes(keyword) || keyword.length >= 3)
      .slice(0, 6)
    const node = makeNode({
      id: extensionId(parentId, title, extensionKeywords),
      type: 'extension',
      title,
      summary: step,
      source: `idea-extension:${idea.id}:${index + 1}`,
      confidence: idea.classification === 'blocked' ? 'weak' : 'medium',
      keywords: extensionKeywords,
      relatedProjectNames: idea.existingProjectAnalysis.matches.map((match) => match.projectName),
      now,
      thinking: {
        understanding: `這是分身從「${idea.title}」自動延伸出的第 ${index + 1} 條探索線。`,
        whyItMatters: 'Kevin 期待分身不是只顯示原始想法，而是能沿著想法繼續長出可追問、可研究、可交給 OpenCode 的節點。',
        nextExploration: step,
        evidence: [`來源想法：${idea.title}`, ...idea.reasons.slice(0, 2)],
        missingEvidence: idea.classification === 'explore' ? ['需要 Kevin 補更多使用情境或判斷標準。'] : [],
      },
    })
    return { ...node, seenCount: 1, lastSeenAt: now }
  })
  const deduped = new Map<string, IdeaGraphNode>()
  for (const node of generated) {
    if (!deduped.has(node.id)) deduped.set(node.id, node)
  }
  return [...deduped.values()]
}

function creativeExplorationStep(idea: IdeaRecord, keywords: string[]): string {
  const primary = keywords[0] ?? idea.title
  const secondary = keywords.find((keyword) => keyword !== primary) ?? 'Kevin 的實際工作流'
  const lenses = [
    `反過來想：如果「${primary}」完全沒用，最可能是哪個前提錯了？先找反例和警訊。`,
    `把「${primary}」接到「${secondary}」：想一個不是功能清單、而是每天會自然打開的使用情境。`,
    `找外部參照：搜尋跟「${primary}」相似的 agent / dashboard / research workflow，挑一個可偷學的互動模式。`,
    `做一個怪但可驗證的 prototype：只用一個畫面證明「${primary}」真的會幫 Kevin 少想一步。`,
  ]
  return lenses[Math.abs(hashString(`${idea.id}:${idea.title}`)) % lenses.length]
}

function suppressedKeywordSet(graph: StoredIdeaGraph): Set<string> {
  return new Set(graph.nodes
    .filter((node) => node.ignored && node.type === 'keyword')
    .flatMap((node) => node.keywords.length > 0 ? node.keywords : [node.title])
    .map((keyword) => keyword.toLowerCase()))
}

function graphFeedbackProfile(graph: StoredIdeaGraph): GraphFeedbackProfile {
  const interestingNodes = graph.nodes.filter((node) => node.interesting && !node.ignored && !node.archived)
  return {
    keywords: new Set(interestingNodes.flatMap((node) => node.keywords).map((keyword) => keyword.toLowerCase())),
    projectNames: new Set(interestingNodes.flatMap((node) => node.relatedProjectNames).map((project) => project.toLowerCase())),
  }
}

function ideaFeedbackScore(idea: IdeaRecord, feedback: GraphFeedbackProfile): number {
  const keywords = extractIdeaKeywords(idea.rawText)
  return keywords.filter((keyword) => feedback.keywords.has(keyword.toLowerCase())).length * 2
    + idea.existingProjectAnalysis.matches.filter((match) => feedback.projectNames.has(match.projectName.toLowerCase())).length * 3
}

function filterSuppressedKeywords(keywords: string[], suppressedKeywords: Set<string>): string[] {
  return keywords.filter((keyword) => !isSuppressedKeyword(keyword, suppressedKeywords))
}

function isSuppressedKeyword(keyword: string, suppressedKeywords: Set<string>): boolean {
  const normalized = keyword.toLowerCase()
  return suppressedKeywords.has(normalized) || [...suppressedKeywords].some((suppressed) => normalized.includes(suppressed) || suppressed.includes(normalized))
}

function hasSuppressedKeyword(value: string, suppressedKeywords: Set<string>): boolean {
  const normalized = value.toLowerCase()
  return [...suppressedKeywords].some((keyword) => normalized.includes(keyword))
}

function hashString(value: string): number {
  let hash = 0
  for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return hash
}

function shortTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 32 ? `${normalized.slice(0, 29)}...` : normalized
}

function makeActions(type: IdeaGraphNodeType, hasPrompt: boolean, confidence: IdeaGraphConfidence, interesting = false): IdeaGraphAction[] {
  return [
    { id: 'extend', label: '延伸這個節點', description: '從這個節點長出 research / prototype / integration 方向。', enabled: type !== 'task' },
    { id: 'find-relationships', label: '找更多關聯', description: '從關鍵字、專案、訊號再找相似節點。', enabled: type !== 'task' },
    { id: 'copy-opencode-prompt', label: '變成 OpenCode 任務', description: '只複製 bounded prompt，不自動執行。', enabled: hasPrompt },
    { id: 'mark-interesting', label: interesting ? '已標記有趣' : '標記有趣', description: '保留這條線，之後讓分身繼續想。', enabled: !interesting },
    { id: 'stop-exploring', label: '先不要想這條', description: '隱藏這個節點，之後不再放進可見腦圖。', enabled: type !== 'double' },
  ]
}

function makeNodePrompt(input: {
  type: IdeaGraphNodeType
  title: string
  summary: string
  source: string
  confidence: IdeaGraphConfidence
  keywords: string[]
  relatedProjectNames: string[]
  thinking: IdeaGraphNode['thinking']
}): string {
  return [
    'Read HomeProject rules and Kevin Autopilot rules before acting.',
    'Task: investigate this Neural Cockpit node and produce a read-only plan or evidence summary.',
    `Node: ${input.title}`,
    `Type: ${input.type}`,
    `Source: ${input.source}`,
    `Confidence: ${input.confidence}`,
    `Summary: ${input.summary}`,
    `Why it matters: ${input.thinking.whyItMatters}`,
    `Next exploration: ${input.thinking.nextExploration}`,
    `Keywords: ${input.keywords.join(', ') || 'none'}`,
    `Related projects: ${input.relatedProjectNames.join(', ') || 'none'}`,
    `Evidence: ${input.thinking.evidence.join(' | ') || 'none yet'}`,
    `Missing evidence: ${input.thinking.missingEvidence.join(' | ') || 'none listed'}`,
    'Constraints: do not edit target repositories, do not commit/push/deploy other projects, do not read secrets, and do not perform destructive actions. If implementation seems useful, return a bounded proposal and verification checklist first.',
  ].join('\n')
}

function normalizeNodeActions(node: IdeaGraphNode): IdeaGraphNode {
  const prompt = node.prompt ?? makeNodePrompt(node)
  return {
    ...node,
    prompt,
    actions: makeActions(node.type, Boolean(prompt), node.confidence, Boolean(node.interesting)),
  }
}

function relationshipScore(a: IdeaGraphNode, b: IdeaGraphNode): number {
  return sharedKeywords(a, b).length + sharedProjects(a, b).length * 2
}

function sharedKeywords(a: IdeaGraphNode, b: IdeaGraphNode): string[] {
  const bKeywords = new Set(b.keywords.map((keyword) => keyword.toLowerCase()))
  return a.keywords.filter((keyword) => bKeywords.has(keyword.toLowerCase()))
}

function sharedProjects(a: IdeaGraphNode, b: IdeaGraphNode): string[] {
  const bProjects = new Set(b.relatedProjectNames.map((project) => project.toLowerCase()))
  return a.relatedProjectNames.filter((project) => bProjects.has(project.toLowerCase()))
}

function relationshipRationale(a: IdeaGraphNode, b: IdeaGraphNode): string {
  const keywords = sharedKeywords(a, b)
  if (keywords.length > 0) return `共同關鍵字：${keywords.slice(0, 3).join(', ')}`
  const projects = sharedProjects(a, b)
  if (projects.length > 0) return `共同關聯專案：${projects.slice(0, 3).join(', ')}`
  return '分身找到可一起觀察的相鄰節點。'
}

function makeEdge(from: string, to: string, type: IdeaGraphEdgeType, rationale: string, confidence: IdeaGraphConfidence, source: string, now: string): IdeaGraphEdge {
  return {
    id: `${type}-${safeId(from)}-${safeId(to)}`,
    type,
    from,
    to,
    rationale,
    confidence,
    source,
    createdAt: now,
    updatedAt: now,
  }
}

function recurrentKeywords(ideas: IdeaRecord[], report: ObservationReport): string[] {
  const counts = new Map<string, number>()
  const add = (keyword: string): void => {
    counts.set(keyword, (counts.get(keyword) ?? 0) + 1)
  }
  for (const idea of ideas) extractIdeaKeywords(idea.rawText).forEach(add)
  for (const candidate of report.candidates) extractIdeaKeywords(candidate.title).forEach(add)
  if (counts.size === 0) ['分身', 'agent', '自動觀察', 'OpenCode', 'prototype', '想法宇宙'].forEach(add)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([keyword]) => keyword)
}

function isResearchWorthyKeyword(keyword: string): boolean {
  const normalized = keyword.toLowerCase()
  return normalized.length >= 4 && !STOP_WORDS.has(normalized) && !BORING_RESEARCH_KEYWORDS.has(normalized) && !/^\d+$/.test(normalized)
}

function mergeGraph(base: StoredIdeaGraph, projected: StoredIdeaGraph): StoredIdeaGraph {
  const nodes = new Map<string, IdeaGraphNode>()
  const baseIds = new Set(base.nodes.map((node) => node.id))
  const hiddenBaseIds = new Set(base.nodes.filter((node) => node.archived || node.ignored).map((node) => node.id))
  for (const node of [...base.nodes, ...projected.nodes]) {
    if (hiddenBaseIds.has(node.id)) {
      const hidden = base.nodes.find((item) => item.id === node.id)
      if (hidden) nodes.set(hidden.id, normalizeNodeActions(hidden))
      continue
    }
    if (node.archived || node.ignored) continue
    if (isLegacyLiteralMetaphorNode(node)) continue
    const existing = nodes.get(node.id)
    const merged = existing
      ? {
          ...existing,
          ...node,
          createdAt: existing.createdAt,
          interesting: existing.interesting,
          interestingAt: existing.interestingAt,
        }
      : node
    const upserted = applyExtensionUpsert(merged, existing, baseIds.has(node.id))
    nodes.set(node.id, normalizeNodeActions(upserted))
  }
  const edges = new Map<string, IdeaGraphEdge>()
  for (const edge of [...base.edges, ...projected.edges]) edges.set(edge.id, edges.get(edge.id) ? { ...edges.get(edge.id), ...edge } : edge)
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)) }
}

function applyExtensionUpsert(merged: IdeaGraphNode, existing: IdeaGraphNode | undefined, existedInBase: boolean): IdeaGraphNode {
  if (merged.type !== 'extension') return merged
  if (!existing) {
    return {
      ...merged,
      seenCount: existedInBase ? Math.max(1, merged.seenCount ?? 1) : 1,
      lastSeenAt: merged.lastSeenAt ?? merged.updatedAt,
    }
  }
  return {
    ...merged,
    seenCount: (existing.seenCount ?? 1) + 1,
    lastSeenAt: merged.updatedAt,
  }
}

function isLegacyLiteralMetaphorNode(node: IdeaGraphNode): boolean {
  const isGeneratedNode = node.source === 'deterministic-research-seed'
    || node.source === 'keyword:電子羊'
    || node.source.startsWith('extension:')
    || node.source.startsWith('research-seed:')
  return isGeneratedNode && LEGACY_LITERAL_METAPHOR_PATTERN.test(JSON.stringify(node))
}

function toFocusedGraph(graph: StoredIdeaGraph, report: ObservationReport): IdeaGraph {
  const center = graph.nodes.find((node) => node.id === CENTER_NODE_ID) ?? graph.nodes[0]
  const centerId = center?.id ?? CENTER_NODE_ID
  const feedback = graphFeedbackProfile(graph)
  const prioritized = graph.nodes
    .filter((node) => !node.archived && !node.ignored && node.type !== 'keyword' && !isNoisyResearchNode(node))
    .sort((a, b) => nodeWeight(b, centerId, feedback) - nodeWeight(a, centerId, feedback) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 28)
  const visibleIds = new Set(prioritized.map((node) => node.id))
  return {
    generatedAt: new Date().toISOString(),
    centerNodeId: centerId,
    nodes: prioritized,
    edges: graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)).slice(0, 48),
    focus: {
      status: report.mainAgent.recommendation.decision,
      headline: report.mainAgent.summary,
      nextThought: report.mainAgent.recommendation.nextAction,
    },
  }
}

function nodeWeight(node: IdeaGraphNode, centerId: string, feedback: GraphFeedbackProfile): number {
  if (node.id === centerId) return 1000
  const typeWeight: Record<IdeaGraphNodeType, number> = { double: 90, idea: 80, research: 72, extension: 70, signal: 68, project: 62, keyword: 55, task: 50 }
  const confidenceWeight: Record<IdeaGraphConfidence, number> = { strong: 12, medium: 7, weak: 3 }
  const interestingWeight = node.interesting ? 24 : 0
  return typeWeight[node.type] + confidenceWeight[node.confidence] + interestingWeight + feedbackWeight(node, feedback)
}

function feedbackWeight(node: IdeaGraphNode, feedback: GraphFeedbackProfile): number {
  if (node.interesting) return 0
  const keywordMatches = node.keywords.filter((keyword) => feedback.keywords.has(keyword.toLowerCase())).length
  const projectMatches = node.relatedProjectNames.filter((project) => feedback.projectNames.has(project.toLowerCase())).length
  return Math.min(keywordMatches * 6, 18) + Math.min(projectMatches * 6, 12)
}

function isNoisyResearchNode(node: IdeaGraphNode): boolean {
  return node.type === 'research'
    && node.source === 'deterministic-research-seed'
    && node.keywords.some((keyword) => !isResearchWorthyKeyword(keyword))
}

async function loadStoredGraph(config: AutopilotConfig): Promise<StoredIdeaGraph> {
  try {
    const parsed = JSON.parse(await readFile(graphPath(config), 'utf8')) as Partial<StoredIdeaGraph>
    const raw: StoredIdeaGraph = {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    }
    return migrateExtensionDuplicates(raw)
  } catch {
    return { nodes: [], edges: [] }
  }
}

export function migrateExtensionDuplicates(graph: StoredIdeaGraph): StoredIdeaGraph {
  const idRewrites = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.type !== 'extension') continue
    const parent = legacyExtensionParentId(node.source)
    if (!parent) continue
    const canonical = extensionId(parent, node.title, node.keywords)
    if (canonical !== node.id) idRewrites.set(node.id, canonical)
  }

  if (idRewrites.size === 0) return graph

  const winners = new Map<string, IdeaGraphNode>()
  for (const node of graph.nodes) {
    const targetId = idRewrites.get(node.id) ?? node.id
    const existing = winners.get(targetId)
    if (!existing) {
      winners.set(targetId, { ...node, id: targetId })
      continue
    }
    const winner = node.createdAt < existing.createdAt ? node : existing
    const loser = node.createdAt < existing.createdAt ? existing : node
    winners.set(targetId, {
      ...winner,
      id: targetId,
      seenCount: Math.max(existing.seenCount ?? 1, node.seenCount ?? 1) + 1,
      lastSeenAt: loser.updatedAt > (winner.lastSeenAt ?? winner.updatedAt) ? loser.updatedAt : (winner.lastSeenAt ?? winner.updatedAt),
    })
  }

  const dedupedEdges = new Map<string, IdeaGraphEdge>()
  for (const edge of graph.edges) {
    const from = idRewrites.get(edge.from) ?? edge.from
    const to = idRewrites.get(edge.to) ?? edge.to
    const id = `${edge.type}-${safeId(from)}-${safeId(to)}`
    dedupedEdges.set(id, { ...edge, id, from, to })
  }

  return { nodes: [...winners.values()], edges: [...dedupedEdges.values()] }
}

function legacyExtensionParentId(source: string): string | undefined {
  if (source.startsWith('idea-extension:')) {
    const rest = source.substring('idea-extension:'.length)
    const colonIdx = rest.lastIndexOf(':')
    const ideaId = colonIdx > 0 ? rest.substring(0, colonIdx) : rest
    if (ideaId) return `idea-${safeId(ideaId)}`
  }
  if (source.startsWith('extension:')) {
    const parent = source.substring('extension:'.length)
    if (parent) return parent
  }
  return undefined
}

async function saveStoredGraph(config: AutopilotConfig, graph: StoredIdeaGraph): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(graphPath(config), `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
}

function graphPath(config: AutopilotConfig): string {
  return join(config.dataDir, GRAPH_FILE)
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'node'
}

export function stableHash6(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0').slice(0, 6)
}

function normalizeExtensionTitle(title: string): string {
  const stripped = title.normalize('NFKC').replace(EXTENSION_TITLE_PREFIX, '').toLowerCase()
  return stripped.replace(/\s+/g, ' ').replace(/[.。!?！？,，;；:：、…\-\.\s]+$/u, '').trim()
}

function signatureForExtension(parentId: string, title: string, keywords: string[]): string {
  const normalizedTitle = normalizeExtensionTitle(title)
  const topKeywords = [...new Set(keywords.map((keyword) => keyword.toLowerCase()))].sort().slice(0, 3).join('|')
  return stableHash6(`${parentId}::${normalizedTitle}::${topKeywords}`)
}

function extensionId(parentId: string, title: string, keywords: string[]): string {
  return `extension-${safeId(parentId)}-${signatureForExtension(parentId, title, keywords)}`
}
