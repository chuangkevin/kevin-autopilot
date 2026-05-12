import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AutopilotConfig } from './types.js'

export async function loadConfig(configPath: string): Promise<AutopilotConfig> {
  const resolvedPath = resolve(configPath)
  const raw = await readFile(resolvedPath, 'utf8')
  const parsed = JSON.parse(raw) as Partial<AutopilotConfig>
  validateConfig(parsed, resolvedPath)
  return parsed
}

function validateConfig(config: Partial<AutopilotConfig>, configPath: string): asserts config is AutopilotConfig {
  if (!config.environment) {
    throw new Error(`Missing environment in ${configPath}`)
  }

  if (!config.dataDir) {
    throw new Error(`Missing dataDir in ${configPath}`)
  }

  if (!Array.isArray(config.ruleSources)) {
    throw new Error(`Missing ruleSources array in ${configPath}`)
  }

  if (!Array.isArray(config.repositories)) {
    throw new Error(`Missing repositories array in ${configPath}`)
  }

  if (!Array.isArray(config.services)) {
    throw new Error(`Missing services array in ${configPath}`)
  }

  if (config.backgroundObservation !== undefined && (!config.backgroundObservation || typeof config.backgroundObservation !== 'object' || Array.isArray(config.backgroundObservation))) {
    throw new Error(`backgroundObservation must be an object in ${configPath}`)
  }

  if (config.backgroundObservation?.enabled !== undefined && typeof config.backgroundObservation.enabled !== 'boolean') {
    throw new Error(`backgroundObservation.enabled must be a boolean in ${configPath}`)
  }

  if (config.backgroundObservation?.intervalMs !== undefined) {
    const intervalMs = config.backgroundObservation.intervalMs
    if (!Number.isInteger(intervalMs) || intervalMs < 60_000) {
      throw new Error(`backgroundObservation.intervalMs must be at least 60000 in ${configPath}`)
    }
  }

  if (config.webResearch !== undefined && (!config.webResearch || typeof config.webResearch !== 'object' || Array.isArray(config.webResearch))) {
    throw new Error(`webResearch must be an object in ${configPath}`)
  }

  if (config.webResearch?.enabled !== undefined && typeof config.webResearch.enabled !== 'boolean') {
    throw new Error(`webResearch.enabled must be a boolean in ${configPath}`)
  }

  if (config.webResearch?.maxQueriesPerGraph !== undefined && (!Number.isInteger(config.webResearch.maxQueriesPerGraph) || config.webResearch.maxQueriesPerGraph < 1 || config.webResearch.maxQueriesPerGraph > 5)) {
    throw new Error(`webResearch.maxQueriesPerGraph must be an integer from 1 to 5 in ${configPath}`)
  }

  if (config.webResearch?.cacheTtlMs !== undefined && (!Number.isInteger(config.webResearch.cacheTtlMs) || config.webResearch.cacheTtlMs < 60_000)) {
    throw new Error(`webResearch.cacheTtlMs must be at least 60000 in ${configPath}`)
  }

  if (config.webResearch?.timeoutMs !== undefined && (!Number.isInteger(config.webResearch.timeoutMs) || config.webResearch.timeoutMs < 1000)) {
    throw new Error(`webResearch.timeoutMs must be at least 1000 in ${configPath}`)
  }
}
