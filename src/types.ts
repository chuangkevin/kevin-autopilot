export interface AutopilotConfig {
  environment: string
  dataDir: string
  ai?: AiConfig
  ruleSources: RuleSourceConfig[]
  repositories: RepositoryConfig[]
  services: ServiceConfig[]
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
  safety: SafetySummary
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
  thinking: IdeaThinkingSummary
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
