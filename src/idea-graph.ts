import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AutopilotConfig,
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
  ObservationReport,
} from './types.js'

const GRAPH_FILE = 'idea-graph.json'
const CENTER_NODE_ID = 'double-kevin-autopilot'
const STOP_WORDS = new Set(['我要', '可以', '現在', '這個', '那個', '一個', '不是', '就是', '沒有', '什麼', 'the', 'and', 'with', 'that'])
const LEGACY_LITERAL_METAPHOR_PATTERN = /電子羊|electric sheep/i

interface StoredIdeaGraph {
  nodes: IdeaGraphNode[]
  edges: IdeaGraphEdge[]
}

export async function getIdeaGraph(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[]): Promise<IdeaGraph> {
  const stored = await loadStoredGraph(config)
  const graph = mergeGraph(stored, createProjectedGraph(config, report, ideas))
  await saveStoredGraph(config, graph)
  return toFocusedGraph(graph, report)
}

export async function getIdeaGraphNodeDetail(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[], nodeId: string): Promise<IdeaGraphNodeDetail | undefined> {
  const graph = await getIdeaGraph(config, report, ideas)
  return selectGraphNode(graph, nodeId)
}

export async function extendIdeaGraphNode(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[], nodeId: string): Promise<IdeaGraphNodeDetail | undefined> {
  const stored = await loadStoredGraph(config)
  const graph = mergeGraph(stored, createProjectedGraph(config, report, ideas))
  const selected = graph.nodes.find((node) => node.id === nodeId)
  if (!selected) return undefined

  const now = new Date().toISOString()
  const extensionNode = makeNode({
    id: `extension-${safeId(selected.id)}-${Date.now()}`,
    type: 'extension',
    title: `延伸：${selected.title}`,
    summary: `從「${selected.title}」再長出一條可探索方向。`,
    source: `extension:${selected.id}`,
    confidence: selected.confidence === 'strong' ? 'medium' : selected.confidence,
    keywords: selected.keywords.slice(0, 6),
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
  const researchNode = makeNode({
    id: `research-${safeId(selected.id)}-${Date.now()}`,
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

function createProjectedGraph(config: AutopilotConfig, report: ObservationReport, ideas: IdeaRecord[]): StoredIdeaGraph {
  const now = new Date().toISOString()
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
    const keywords = extractIdeaKeywords(idea.rawText)
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
    const signalNode = makeSignalNode(candidate, now)
    nodes.push(signalNode)
    edges.push(makeEdge(CENTER_NODE_ID, signalNode.id, candidate.confidence === 'suspected' ? 'needs_evidence' : 'observed_in', candidate.evidence[0] ?? 'read-only observation signal', candidate.confidence === 'confirmed' ? 'strong' : candidate.confidence === 'likely' ? 'medium' : 'weak', `candidate:${candidate.id}`, now))
    const projectId = `project-${safeId(candidate.sourceName)}`
    if (nodes.some((node) => node.id === projectId)) {
      edges.push(makeEdge(signalNode.id, projectId, 'observed_in', `訊號來自 ${candidate.sourceName}。`, 'medium', `candidate:${candidate.id}`, now))
    }
    if (candidate.boundedPrompt) {
      const taskNode = makeTaskNode(candidate, now)
      nodes.push(taskNode)
      edges.push(makeEdge(signalNode.id, taskNode.id, 'can_become_task', '這個訊號可以被整理成 bounded OpenCode prompt。', candidate.confidence === 'suspected' ? 'weak' : 'medium', `candidate:${candidate.id}`, now))
    }
  }

  for (const keyword of recurrentKeywords(ideas, report).slice(0, 6)) {
    nodes.push(makeKeywordNode(keyword, now))
    const research = makeResearchSeed(keyword, now)
    nodes.push(research)
    edges.push(makeEdge(CENTER_NODE_ID, research.id, 'can_research', `分身想繼續研究「${keyword}」。`, 'weak', 'deterministic-research-seed', now))
    edges.push(makeEdge(research.id, `keyword-${safeId(keyword)}`, 'contains_keyword', `研究種子連到關鍵字「${keyword}」。`, 'weak', 'deterministic-research-seed', now))
  }

  return { nodes, edges }
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

function makeSignalNode(candidate: ObservationCandidate, now: string): IdeaGraphNode {
  const keywords = extractIdeaKeywords(`${candidate.title} ${candidate.suggestedNextStep} ${candidate.evidence.join(' ')}`)
  return makeNode({
    id: `signal-${safeId(candidate.id)}`,
    type: 'signal',
    title: candidate.title,
    summary: candidate.suggestedNextStep,
    source: `candidate:${candidate.id}`,
    confidence: candidate.confidence === 'confirmed' ? 'strong' : candidate.confidence === 'likely' ? 'medium' : 'weak',
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
    title: `想研究：${keyword}`,
    summary: `待搜尋/待研究的方向：「${keyword}」。目前只是研究種子或夢境聯想，不代表已經查過網路。`,
    source: 'deterministic-research-seed',
    confidence: 'weak',
    keywords: [keyword],
    relatedProjectNames: [],
    now,
    thinking: {
      understanding: `我覺得「${keyword}」可能可以長出新工具、新 prototype 或整合方向；這可以是半夢半醒的聯想，不是事實宣告。`,
      whyItMatters: 'Kevin 會常常打開 Autopilot 看有沒有新奇、有用、可取的想法；夢境感讓分身不只是報告機器。',
      nextExploration: `之後可以設定 approved web source，再搜尋 ${keyword} 的新工具/agent/實作模式。`,
      evidence: ['由既有 ideas / observation keywords 產生。'],
      missingEvidence: ['尚未進行 public web search。'],
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
    actions: makeActions(input.type, Boolean(input.prompt), input.confidence),
    prompt: input.prompt,
  }
}

function makeActions(type: IdeaGraphNodeType, hasPrompt: boolean, confidence: IdeaGraphConfidence): IdeaGraphAction[] {
  return [
    { id: 'extend', label: '延伸這個節點', description: '從這個節點長出 research / prototype / integration 方向。', enabled: type !== 'task' },
    { id: 'find-relationships', label: '找更多關聯', description: '從關鍵字、專案、訊號再找相似節點。', enabled: false },
    { id: 'copy-opencode-prompt', label: '變成 OpenCode 任務', description: '只複製 bounded prompt，不自動執行。', enabled: hasPrompt && confidence !== 'weak' },
    { id: 'mark-interesting', label: '標記有趣', description: '保留這條線，之後讓分身繼續想。', enabled: false },
    { id: 'stop-exploring', label: '先不要想這條', description: '未來可降低或隱藏這類節點。', enabled: false },
  ]
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

function mergeGraph(base: StoredIdeaGraph, projected: StoredIdeaGraph): StoredIdeaGraph {
  const nodes = new Map<string, IdeaGraphNode>()
  for (const node of [...base.nodes, ...projected.nodes]) {
    if (node.archived || node.ignored) continue
    if (isLegacyLiteralMetaphorNode(node)) continue
    const existing = nodes.get(node.id)
    nodes.set(node.id, existing ? { ...existing, ...node, createdAt: existing.createdAt } : node)
  }
  const edges = new Map<string, IdeaGraphEdge>()
  for (const edge of [...base.edges, ...projected.edges]) edges.set(edge.id, edges.get(edge.id) ? { ...edges.get(edge.id), ...edge } : edge)
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)) }
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
  const prioritized = graph.nodes
    .filter((node) => !node.archived && !node.ignored)
    .sort((a, b) => nodeWeight(b, centerId) - nodeWeight(a, centerId) || b.updatedAt.localeCompare(a.updatedAt))
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

function nodeWeight(node: IdeaGraphNode, centerId: string): number {
  if (node.id === centerId) return 1000
  const typeWeight: Record<IdeaGraphNodeType, number> = { double: 90, idea: 80, research: 72, extension: 70, signal: 68, project: 62, keyword: 55, task: 50 }
  const confidenceWeight: Record<IdeaGraphConfidence, number> = { strong: 12, medium: 7, weak: 3 }
  return typeWeight[node.type] + confidenceWeight[node.confidence]
}

async function loadStoredGraph(config: AutopilotConfig): Promise<StoredIdeaGraph> {
  try {
    const parsed = JSON.parse(await readFile(graphPath(config), 'utf8')) as Partial<StoredIdeaGraph>
    return { nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [], edges: Array.isArray(parsed.edges) ? parsed.edges : [] }
  } catch {
    return { nodes: [], edges: [] }
  }
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
