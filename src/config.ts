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
}
