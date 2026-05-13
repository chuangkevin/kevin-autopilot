import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutopilotConfig, RuntimeOverrideFieldSchema, RuntimeOverrides, RuntimeOverrideSchema } from './types.js'

const OVERRIDE_FILE = 'runtime-overrides.json'

type RuntimeOverridePath =
  | 'aiReflection.enabled'
  | 'aiReflection.maxOutputTokens'
  | 'aiReflection.maxPendingAiIdeas'
  | 'backgroundObservation.enabled'
  | 'backgroundObservation.intervalMs'

export const RUNTIME_OVERRIDE_SCHEMA: RuntimeOverrideSchema = {
  'aiReflection.enabled': {
    type: 'boolean',
    label: 'AI reflection enabled',
    description: '讓下一輪 graph-changed cycle 呼叫 Gemini 反思，產生 evidence-backed AI idea seeds。',
  },
  'aiReflection.maxOutputTokens': {
    type: 'integer',
    min: 100,
    max: 2000,
    label: 'AI reflection max output tokens',
    description: '限制每次 AI reflection 的 Gemini 輸出 token budget。',
  },
  'aiReflection.maxPendingAiIdeas': {
    type: 'integer',
    min: 1,
    max: 50,
    label: 'AI pending idea cap',
    description: '控制待處理 AI ideas 的上限；超過 cap 時 reflection 不再新增 seeds。',
  },
  'backgroundObservation.enabled': {
    type: 'boolean',
    label: 'Background observation enabled',
    description: '控制 read-only background observation loop 是否繼續排程下一輪。',
  },
  'backgroundObservation.intervalMs': {
    type: 'integer',
    min: 60_000,
    max: 3_600_000,
    label: 'Background interval ms',
    description: '設定 background observation loop 每輪之間的等待毫秒數。',
  },
}

export class RuntimeOverrideError extends Error {
  constructor(public readonly code: 'not-in-whitelist' | 'invalid-value', public readonly key: string, message?: string) {
    super(message ?? `Runtime override ${key} is ${code}`)
  }
}

export async function loadRuntimeOverrides(config: AutopilotConfig): Promise<RuntimeOverrides> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(config.dataDir, OVERRIDE_FILE), 'utf8'))
  } catch {
    return {}
  }
  if (!isPlainObject(parsed)) {
    console.warn('runtime-overrides.json must contain an object; ignoring file')
    return {}
  }
  return sanitizeOverrides(parsed, { warn: true })
}

export async function saveRuntimeOverrides(config: AutopilotConfig, overrides: unknown): Promise<RuntimeOverrides> {
  if (!isPlainObject(overrides)) throw new RuntimeOverrideError('invalid-value', '<root>', 'Runtime overrides request body must be an object')
  const current = await loadRuntimeOverrides(config)
  const next = cloneOverrides(current)
  for (const [key, value] of flattenPatch(overrides)) {
    const schema = RUNTIME_OVERRIDE_SCHEMA[key]
    if (!schema) throw new RuntimeOverrideError('not-in-whitelist', key, `Runtime override is not whitelisted: ${key}`)
    if (value === null) removeOverride(next, key as RuntimeOverridePath)
    else setOverride(next, key as RuntimeOverridePath, validateValue(key, value, schema))
  }
  pruneEmptyGroups(next)
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(join(config.dataDir, OVERRIDE_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

export function applyRuntimeOverrides(config: AutopilotConfig, overrides: RuntimeOverrides): AutopilotConfig {
  const effective = JSON.parse(JSON.stringify(config)) as AutopilotConfig
  for (const key of Object.keys(RUNTIME_OVERRIDE_SCHEMA) as RuntimeOverridePath[]) {
    const value = getOverride(overrides, key)
    if (value !== undefined) setConfigValue(effective, key, value)
  }
  return effective
}

export async function getEffectiveConfig(config: AutopilotConfig): Promise<AutopilotConfig> {
  return applyRuntimeOverrides(config, await loadRuntimeOverrides(config))
}

function sanitizeOverrides(input: Record<string, unknown>, options: { warn: boolean }): RuntimeOverrides {
  const sanitized: RuntimeOverrides = {}
  for (const [key, value] of flattenPatch(input)) {
    const schema = RUNTIME_OVERRIDE_SCHEMA[key]
    if (!schema) continue
    if (value === null) continue
    try {
      setOverride(sanitized, key as RuntimeOverridePath, validateValue(key, value, schema))
    } catch (error) {
      if (options.warn) console.warn(error instanceof Error ? error.message : String(error))
    }
  }
  pruneEmptyGroups(sanitized)
  return sanitized
}

function validateValue(key: string, value: unknown, schema: RuntimeOverrideFieldSchema): boolean | number {
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new RuntimeOverrideError('invalid-value', key, `Runtime override ${key} must be a boolean`)
    return value
  }
  if (!Number.isInteger(value)) throw new RuntimeOverrideError('invalid-value', key, `Runtime override ${key} must be an integer`)
  const numberValue = value as number
  if (schema.min !== undefined && numberValue < schema.min) throw new RuntimeOverrideError('invalid-value', key, `Runtime override ${key} must be >= ${schema.min}`)
  if (schema.max !== undefined && numberValue > schema.max) throw new RuntimeOverrideError('invalid-value', key, `Runtime override ${key} must be <= ${schema.max}`)
  return numberValue
}

function flattenPatch(input: Record<string, unknown>): Array<[string, unknown]> {
  const fields: Array<[string, unknown]> = []
  for (const [group, value] of Object.entries(input)) {
    if (RUNTIME_OVERRIDE_SCHEMA[group]) {
      fields.push([group, value])
      continue
    }
    if (!isPlainObject(value)) {
      fields.push([group, value])
      continue
    }
    for (const [field, fieldValue] of Object.entries(value)) fields.push([`${group}.${field}`, fieldValue])
  }
  return fields
}

function getOverride(overrides: RuntimeOverrides, path: RuntimeOverridePath): boolean | number | undefined {
  const [group, field] = path.split('.') as [keyof RuntimeOverrides, string]
  const value = overrides[group] as Record<string, boolean | number | undefined> | undefined
  return value?.[field]
}

function setOverride(overrides: RuntimeOverrides, path: RuntimeOverridePath, value: boolean | number): void {
  const [group, field] = path.split('.') as [keyof RuntimeOverrides, string]
  const bucket = (overrides[group] ??= {}) as Record<string, boolean | number | undefined>
  bucket[field] = value
}

function removeOverride(overrides: RuntimeOverrides, path: RuntimeOverridePath): void {
  const [group, field] = path.split('.') as [keyof RuntimeOverrides, string]
  const bucket = overrides[group] as Record<string, boolean | number | undefined> | undefined
  if (bucket) delete bucket[field]
}

function setConfigValue(config: AutopilotConfig, path: RuntimeOverridePath, value: boolean | number): void {
  const [group, field] = path.split('.') as ['aiReflection' | 'backgroundObservation', string]
  const bucket = (config[group] ??= {}) as Record<string, boolean | number | undefined>
  bucket[field] = value
}

function pruneEmptyGroups(overrides: RuntimeOverrides): void {
  if (overrides.aiReflection && Object.keys(overrides.aiReflection).length === 0) delete overrides.aiReflection
  if (overrides.backgroundObservation && Object.keys(overrides.backgroundObservation).length === 0) delete overrides.backgroundObservation
}

function cloneOverrides(overrides: RuntimeOverrides): RuntimeOverrides {
  return JSON.parse(JSON.stringify(overrides)) as RuntimeOverrides
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
