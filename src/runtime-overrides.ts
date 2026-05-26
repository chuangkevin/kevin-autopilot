import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutopilotConfig, RuntimeOverrideFieldSchema, RuntimeOverrides, RuntimeOverrideSchema } from './types.js'

const OVERRIDES_FILE = 'runtime-overrides.json'

export const RUNTIME_OVERRIDE_SCHEMA: RuntimeOverrideSchema = {
  'radarScan.enabled': {
    type: 'boolean',
    label: 'Radar Scan Enabled',
    description: 'Enable or disable background radar scanning',
  },
  'radarScan.intervalMs': {
    type: 'integer',
    min: 60_000,
    max: 86_400_000,
    label: 'Scan Interval (ms)',
    description: 'How often to run a background scan (min 60s)',
  },
}

export class RuntimeOverrideError extends Error {}

export async function loadRuntimeOverrides(config: AutopilotConfig): Promise<RuntimeOverrides> {
  try {
    const raw = await readFile(join(config.dataDir, OVERRIDES_FILE), 'utf8')
    return JSON.parse(raw) as RuntimeOverrides
  } catch {
    return {}
  }
}

export async function saveRuntimeOverrides(config: AutopilotConfig, overrides: unknown): Promise<RuntimeOverrides> {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new RuntimeOverrideError('overrides must be a plain object')
  }
  const schema = RUNTIME_OVERRIDE_SCHEMA
  const validated: RuntimeOverrides = {}
  for (const [dotKey, value] of Object.entries(overrides as Record<string, unknown>)) {
    const fieldSchema = schema[dotKey] as RuntimeOverrideFieldSchema | undefined
    if (!fieldSchema) throw new RuntimeOverrideError(`Unknown override key: ${dotKey}`)
    if (fieldSchema.type === 'boolean' && typeof value !== 'boolean') throw new RuntimeOverrideError(`${dotKey} must be boolean`)
    if (fieldSchema.type === 'integer') {
      if (!Number.isInteger(value)) throw new RuntimeOverrideError(`${dotKey} must be integer`)
      if (fieldSchema.min !== undefined && (value as number) < fieldSchema.min) throw new RuntimeOverrideError(`${dotKey} must be >= ${fieldSchema.min}`)
      if (fieldSchema.max !== undefined && (value as number) > fieldSchema.max) throw new RuntimeOverrideError(`${dotKey} must be <= ${fieldSchema.max}`)
    }
    const [section, field] = dotKey.split('.') as [keyof RuntimeOverrides, string]
    if (!validated[section]) (validated as Record<string, unknown>)[section] = {}
    ;(validated[section] as Record<string, unknown>)[field] = value
  }
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(join(config.dataDir, OVERRIDES_FILE), JSON.stringify(validated, null, 2))
  return validated
}

export function applyRuntimeOverrides(config: AutopilotConfig, overrides: RuntimeOverrides): AutopilotConfig {
  const merged = { ...config }
  if (overrides.radarScan) {
    merged.radarScan = { ...config.radarScan, ...overrides.radarScan }
  }
  return merged
}

export async function getEffectiveConfig(config: AutopilotConfig): Promise<AutopilotConfig> {
  const overrides = await loadRuntimeOverrides(config)
  return applyRuntimeOverrides(config, overrides)
}
