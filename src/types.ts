export interface AutopilotConfig {
  environment: string
  dataDir: string
  ai?: AiConfig
  backgroundObservation?: BackgroundObservationConfig
  ruleSources: RuleSourceConfig[]
  repositories: RepositoryConfig[]
  services: ServiceConfig[]
}

export interface BackgroundObservationConfig {
  enabled?: boolean
  intervalMs?: number
}

export interface AiConfig {
  enabled: boolean
  provider: 'gemini'
  model: string
  timeoutMs?: number
  validateImportedKeys?: boolean
}

export interface RuleSourceConfig {
  name: string
  path: string
  required: boolean
  entryFiles: string[]
}

export interface RepositoryConfig {
  name: string
  path: string
}

export interface ServiceConfig {
  name: string
  domain?: string
  host?: string
  port?: number
  source: string
  repository?: string
  healthCheck?: HealthCheckConfig
}

export interface HealthCheckConfig {
  enabled: boolean
  url?: string
  timeoutMs?: number
}

export interface RuleSourceObservation {
  name: string
  path: string
  required: boolean
  exists: boolean
  loadedFiles: LoadedRuleFile[]
  missingFiles: string[]
}

export interface LoadedRuleFile {
  relativePath: string
  bytes: number
}

export interface RepositoryObservation {
  name: string
  path: string
  exists: boolean
  branch?: string
  dirty?: boolean
  recentCommits: string[]
  error?: string
}

export interface ServiceObservation {
  name: string
  domain?: string
  host?: string
  port?: number
  source: string
  repository?: string
  healthStatus: 'disabled' | 'ok' | 'failed' | 'not_configured'
  healthDetail?: string
}

export interface ObservationReport {
  generatedAt: string
  version: string
  environment: string
  ruleSources: RuleSourceObservation[]
  repositories: RepositoryObservation[]
  services: ServiceObservation[]
  projectRadar: ProjectRadarItem[]
  candidates: ObservationCandidate[]
  supplements: UserSupplement[]
  mainAgent: MainAgentBrief
  safety: SafetySummary
}

export type ProjectRadarStatus = 'needs_attention' | 'watching' | 'healthy' | 'unknown'

export interface ProjectRadarItem {
  name: string
  status: ProjectRadarStatus
  repository?: RepositoryObservation
  services: ServiceObservation[]
  candidateIds: string[]
  signals: string[]
  nextObservation: string
}

export interface UserSupplement {
  id: string
  createdAt: string
  environment: string
  rawText: string
  summary: string
  source: 'dashboard'
  appliesTo: 'next_observation'
}

export interface MainAgentBrief {
  mode: 'kevin-double-deterministic'
  persona: 'Kevin 子人格主 agent'
  superpowers: string[]
  summary: string
  activeTask: MainAgentTaskState
  rounds: MainAgentRound[]
  feasibleOptions: FeasibleOption[]
  recommendation: MainAgentRecommendation
  qualityReview: MainAgentQualityReview
}

export interface MainAgentQualityReview {
  verdict: 'qualified' | 'needs_more_context' | 'not_qualified'
  score: number
  summary: string
  checks: MainAgentQualityCheck[]
  gaps: MainAgentQualityGap[]
  improvements: string[]
  nextReviewFocus: string
}

export interface MainAgentQualityGap {
  severity: 'low' | 'medium' | 'high'
  gap: string
  neededEvidence: string
  upgradeCondition: string
}

export interface MainAgentQualityCheck {
  label: string
  status: 'pass' | 'warn' | 'fail'
  evidence: string
}

export interface MainAgentTaskState {
  objective: string
  currentStep: string
  checkpoints: MainAgentCheckpoint[]
  blockers: string[]
  updatedAt: string
  supplementCount: number
}

export interface MainAgentCheckpoint {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

export interface MainAgentRound {
  agent: 'Kevin 子人格' | 'Kevin 補充' | '探索者' | '懷疑者' | '品質審查官' | '建造者'
  role: string
  observation: string
  argument: string
  output: string
}

export interface FeasibleOption {
  label: string
  why: string
  firstStep: string
  tradeoff: string
  approvalRequired: boolean
}

export interface MainAgentRecommendation {
  decision: string
  reason: string
  nextAction: string
  candidateId?: string
  approvalRequired: boolean
}

export type ObservationCandidateCategory =
  | 'bug_watch'
  | 'bug_fix_candidate'
  | 'improvement_candidate'
  | 'prototype_candidate'
  | 'needs_kevin_decision'
  | 'blocked'

export type ObservationCandidateConfidence = 'suspected' | 'likely' | 'confirmed'

export interface ObservationCandidate {
  id: string
  category: ObservationCandidateCategory
  confidence: ObservationCandidateConfidence
  title: string
  sourceType: 'rule_source' | 'repository' | 'service'
  sourceName: string
  evidence: string[]
  expectedBehavior: string
  actualBehavior: string
  suggestedNextStep: string
  approvalRequired: boolean
  risk: 'low' | 'medium' | 'high'
  boundedPrompt: string
}

export interface SafetySummary {
  mode: 'read-only'
  skippedSecretPatterns: string[]
  mutatingActions: 'disabled'
  deploymentActions: 'disabled'
}

export type IdeaClassification = 'explore' | 'plan' | 'prototype' | 'blocked'

export interface IdeaRecord {
  id: string
  createdAt: string
  environment: string
  rawText: string
  title: string
  classification: IdeaClassification
  reasons: string[]
  suggestedNextSteps: string[]
  approvalRequired: boolean
  agentHandoff?: AgentHandoffSummary
  projectHandoff?: ProjectHandoffPlan
  existingProjectAnalysis: ExistingProjectAnalysis
  thinking: IdeaThinkingSummary
}

export interface ObservationLoopState {
  mode: 'read-only-background-observation'
  enabled: boolean
  intervalMs: number
  running: boolean
  runCount: number
  lastStartedAt?: string
  lastFinishedAt?: string
  nextRunAt?: string
  lastSuccess?: boolean
  lastError?: string
  lastReportAt?: string
  lastReportPath?: string
  lastMarkdownPath?: string
}

export type IdeaGraphNodeType = 'double' | 'idea' | 'keyword' | 'project' | 'signal' | 'research' | 'extension' | 'task'

export type IdeaGraphEdgeType = 'contains_keyword' | 'resembles_project' | 'extends' | 'integrates_with' | 'needs_evidence' | 'can_research' | 'can_become_task' | 'observed_in'

export type IdeaGraphConfidence = 'weak' | 'medium' | 'strong'

export interface IdeaGraphThinkingSummary {
  understanding: string
  whyItMatters: string
  nextExploration: string
  evidence: string[]
  missingEvidence: string[]
}

export interface IdeaGraphAction {
  id: 'extend' | 'find-relationships' | 'copy-opencode-prompt' | 'mark-interesting' | 'stop-exploring'
  label: string
  description: string
  enabled: boolean
}

export interface IdeaGraphNode {
  id: string
  type: IdeaGraphNodeType
  title: string
  summary: string
  source: string
  createdAt: string
  updatedAt: string
  confidence: IdeaGraphConfidence
  safety: 'read-only'
  keywords: string[]
  relatedProjectNames: string[]
  thinking: IdeaGraphThinkingSummary
  actions: IdeaGraphAction[]
  archived?: boolean
  ignored?: boolean
  prompt?: string
}

export interface IdeaGraphEdge {
  id: string
  type: IdeaGraphEdgeType
  from: string
  to: string
  rationale: string
  confidence: IdeaGraphConfidence
  source: string
  createdAt: string
  updatedAt: string
}

export interface IdeaGraph {
  generatedAt: string
  centerNodeId: string
  nodes: IdeaGraphNode[]
  edges: IdeaGraphEdge[]
  focus: {
    status: string
    headline: string
    nextThought: string
  }
}

export interface IdeaGraphNodeDetail {
  node: IdeaGraphNode
  connectedNodes: IdeaGraphNode[]
  edges: IdeaGraphEdge[]
}

export type ExistingProjectRecommendation = 'extend-existing' | 'new-project' | 'unclear'

export interface ExistingProjectAnalysis {
  recommendation: ExistingProjectRecommendation
  summary: string
  matches: ExistingProjectMatch[]
}

export interface ExistingProjectMatch {
  projectName: string
  sourceType: 'repository' | 'service'
  sourceName: string
  score: number
  reason: string
  path?: string
  domain?: string
}

export interface ProjectHandoffPlan {
  mode: 'read-only-project-handoff'
  projectName: string
  repoName: string
  objective: string
  recommendedState: IdeaClassification
  firstArtifact: string
  openQuestions: string[]
  approvalGates: string[]
  architectureNotes: string[]
  specDraft: HandoffSpecDraft
  implementationTasks: string[]
  verificationChecklist: string[]
  boundedPrompt: string
}

export interface HandoffSpecDraft {
  changeId: string
  requirements: string[]
  nonGoals: string[]
}

export interface AgentHandoffSummary {
  superpowers: string[]
  agents: AgentQuestionAnswer[]
  decision: string
}

export interface AgentQuestionAnswer {
  from: 'kevin-persona' | 'safety-reviewer' | 'spec-planner'
  to: 'kevin-persona' | 'safety-reviewer' | 'spec-planner'
  question: string
  answer: string
}

export interface IdeaThinkingSummary {
  mode: 'ai-core' | 'deterministic-fallback'
  model?: string
  success: boolean
  error?: string
}

export interface KeyStatusSummary {
  storedCount: number
  envCount: number
  totalAvailable: number
  storedSuffixes: string[]
  envSuffixes: string[]
}

export interface KeyImportSummary {
  imported: number
  ignored: number
  totalStored: number
  replace: boolean
  status: KeyStatusSummary
}
