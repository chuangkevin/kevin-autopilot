export type ReflectionSeedRejectionReason =
  | 'requires-approval'
  | 'meta-self-reference'
  | 'internal-engineering'
  | 'missing-real-world-workflow'

export interface ReflectionSeedQualityInput {
  title?: string
  rawText?: string
  approvalRequired?: boolean
}

const REAL_WORKFLOW_ACTOR_TERMS = [
  '車商', '業務', '客戶', 'customer', 'client', '使用者', 'user', 'users', 'pm', 'product manager', '產品經理',
  'product designer', '設計師', 'designer', 'ux researcher', 'researcher', '店家', '創作者', 'creator', '消防',
  'firefighter', '學員', 'student', '公部門', '玩家', 'npc',
]

const REAL_WORKFLOW_DETAIL_TERMS = [
  'figma', 'ui', 'ux', 'prototype', 'spec', 'usability test', 'usability tests', 'user test', 'user tests',
  'interview', 'interviews', 'transcript', 'transcripts', 'session', 'sessions', 'recording', 'recordings',
  'participant', 'participants', 'finding', 'findings', 'note', 'notes', '課程', '考試', '問卷', '遊戲', 'excel',
  'google sheets', 'spreadsheet', 'csv', 'line', '截圖', 'screenshot', '照片', 'photo', '影片', 'video', 'form',
  'forms', '表單', '文件', 'document', 'documents', '檔案', 'file', 'files', 'pdf', 'pdfs', 'email', 'message', '訊息',
  'invoice', 'receipt', 'erp', 'crm', 'cad', 'onshape', 'pkm', 'personal knowledge', 'knowledge management', '知識管理',
  '日記', 'journal',
]

const DOMAIN_TOOL_TERMS = [
  'figma', 'excel', 'google sheets', 'spreadsheet', 'csv', 'line', 'erp', 'crm', 'cad', 'onshape', 'pkm', 'notion', 'slack',
  'personal knowledge', 'knowledge management', '知識管理',
]

const REAL_WORKFLOW_ACTION_TERMS = [
  '手動', '人工', '重複', '每次', '反覆', 'copy/paste', '複製貼上', '整理', '上傳', '下載',
  '刊登', '發文', '貼文', '上架', '填寫', '填表', '表單', '剪輯', '轉檔', '命名', '查找', '搜尋', '追蹤',
  '回報', '排程', '管理', '記錄', '維護', '校對', '同步', '交接', '審查', '檢查', '耗時', '麻煩', '卡住',
  '痛點', '脆弱', 'workaround', 'manual', 'manually', 'repeated', 'repetition', 'weekly', 'daily', 'copy', 'copies',
  'tag', 'tags', 'tagging', 'summarize', 'summarizes', 'summarise', 'summarises', 'handoff', 'review', 'friction',
  'pain',
]

const META_SELF_REFERENCE_TERMS = [
  'kevin autopilot', 'double-kevin-autopilot', 'autopilot', 'ai reflection', 'reflection seed', 'agent handoff',
  'the double', 'ai double', '分身', '自我監控', 'self-monitor', 'self monitoring', 'self-observ', 'observe the double',
  'mood log', "kevin's mood", 'kevin’s mood', 'interaction pattern', 'engagement level', 'tailored suggestion',
  'proactive suggestion', 'suggestions vs', 'monitor kevin', 'track kevin', 'kevin feedback', 'dashboard hygiene',
]

const INTERNAL_ENGINEERING_TERMS = [
  'repo', 'repository', 'architecture', 'ci', 'deploy', 'deployment', 'docker', 'worktree', 'branch',
  'commit', 'pull request', 'github actions', 'openspec', 'service health', 'runtime config', 'prompt quality',
]

const INTERNAL_TEST_TERMS = ['unit test', 'unit tests', 'integration test', 'integration tests', 'test suite', 'test coverage', 'test', 'tests']

export function getReflectionSeedQualityRejection(
  input: ReflectionSeedQualityInput,
): ReflectionSeedRejectionReason | undefined {
  if (input.approvalRequired === true) return 'requires-approval'

  const text = normalizeQualityText(`${input.title ?? ''} ${input.rawText ?? ''}`)
  const hasWorkflowActor = hasAnyTerm(text, REAL_WORKFLOW_ACTOR_TERMS)
  const workflowDetailCount = countTerms(text, REAL_WORKFLOW_DETAIL_TERMS)
  const hasWorkflowDetail = workflowDetailCount > 0
  const hasDomainTool = hasAnyTerm(text, DOMAIN_TOOL_TERMS)
  const hasWorkflowAction = hasAnyTerm(text, REAL_WORKFLOW_ACTION_TERMS)
  const hasRealWorkflow = hasWorkflowDetail && hasWorkflowAction && (hasWorkflowActor || hasDomainTool || workflowDetailCount >= 2)
  const hasMetaSelfReference = hasAnyTerm(text, META_SELF_REFERENCE_TERMS)
  const hasInternalEngineering = (hasAnyTerm(text, INTERNAL_ENGINEERING_TERMS) || hasAnyTerm(text, INTERNAL_TEST_TERMS))
    && !hasRealWorkflow

  if (hasMetaSelfReference) return 'meta-self-reference'
  if (hasInternalEngineering) return 'internal-engineering'
  if (!hasRealWorkflow) return 'missing-real-world-workflow'
  return undefined
}

export function isLowValueReflectionTopic(input: ReflectionSeedQualityInput): boolean {
  return getReflectionSeedQualityRejection({ ...input, approvalRequired: false }) !== undefined
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => includesTerm(text, term.toLowerCase()))
}

function countTerms(text: string, terms: string[]): number {
  return terms.filter((term) => includesTerm(text, term.toLowerCase())).length
}

function includesTerm(text: string, term: string): boolean {
  if (/^[a-z0-9 .'-]+$/.test(term)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`).test(text)
  }
  return text.includes(term)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeQualityText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}
