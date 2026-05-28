export interface AutopilotConfig {
  environment: string
  dataDir: string
  ai?: AiConfig
  radarScan?: RadarScanConfig
}

export interface AiConfig {
  enabled: boolean
  provider: 'gemini'
  model: string
  timeoutMs?: number
  validateImportedKeys?: boolean
}

export interface RadarScanConfig {
  enabled?: boolean
  intervalMs?: number
}

export interface RuntimeOverrides {
  radarScan?: {
    enabled?: boolean
    intervalMs?: number
  }
}

export interface RuntimeOverrideFieldSchema {
  type: 'boolean' | 'integer'
  min?: number
  max?: number
  label: string
  description: string
}

export type RuntimeOverrideSchema = Record<string, RuntimeOverrideFieldSchema>

export type ProblemSignalSourceType = 'hacker-news' | 'reddit' | 'dcard' | 'manual'

export interface ProblemSignal {
  id: string
  sourceType: ProblemSignalSourceType
  sourceName: string
  title: string
  snippet: string
  url?: string
  fetchedAt: string
}

export interface ProblemCard {
  id: string
  signalId: string
  whoIsInPain: string
  pain: string
  context: string
  currentWorkaround: string
  urgencySignal: string
  ideaSeeds: string[]
  sourceUrl?: string
  createdAt: string
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
