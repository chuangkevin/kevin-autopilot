import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AutopilotConfig, UserSupplement } from './types.js'

const MAX_SUPPLEMENT_LENGTH = 4000
const SECRET_VALUE_PATTERNS = [
  /AIzaSy[0-9A-Za-z_-]{33}/,
  /\bsk-(?:proj-)?[0-9A-Za-z_-]{20,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z_]{20,}\b/,
  /\bgithub_pat_[0-9A-Za-z_]{20,}\b/,
  /\bnpm_[0-9A-Za-z]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /['"]?\bauthorization\b['"]?\s*[:=]\s*['"]?bearer\s+[0-9A-Za-z._~+/=-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]
const SECRET_ASSIGNMENT_RE = /['"]?\b[0-9A-Za-z_-]*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|password|passwd|credential|private[_-]?key|client[_-]?secret|refresh[_-]?token)[0-9A-Za-z_-]*\b['"]?\s*[:=]\s*['"]?[^\s'"]{8,}/i

export async function createSupplement(config: AutopilotConfig, rawText: string): Promise<UserSupplement> {
  const normalizedText = rawText.trim()
  if (!normalizedText) {
    throw new Error('Supplement text is required')
  }

  if (normalizedText.length > MAX_SUPPLEMENT_LENGTH) {
    throw new Error(`Supplement text is too long. Limit: ${MAX_SUPPLEMENT_LENGTH} characters`)
  }

  if (containsSecretValue(normalizedText)) {
    throw new Error('Supplement appears to contain a secret value. Remove keys or private material first.')
  }

  const now = new Date()
  const supplement: UserSupplement = {
    id: makeSupplementId(now),
    createdAt: now.toISOString(),
    environment: config.environment,
    rawText: normalizedText,
    summary: summarizeSupplement(normalizedText),
    source: 'dashboard',
    appliesTo: 'next_observation',
  }

  const dir = supplementsDir(config)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${supplement.id}.json`), `${JSON.stringify(supplement, null, 2)}\n`, 'utf8')
  return supplement
}

export async function listSupplements(config: AutopilotConfig, limit = 20): Promise<UserSupplement[]> {
  const dir = supplementsDir(config)
  await mkdir(dir, { recursive: true })
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort().reverse().slice(0, limit)
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), 'utf8')) as UserSupplement))
}

function summarizeSupplement(rawText: string): string {
  const collapsed = rawText.replace(/\s+/g, ' ').trim()
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed
}

function containsSecretValue(rawText: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(rawText)) || SECRET_ASSIGNMENT_RE.test(rawText)
}

function makeSupplementId(date: Date): string {
  return `supplement-${date.toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`
}

function supplementsDir(config: AutopilotConfig): string {
  return join(config.dataDir, 'supplements')
}
