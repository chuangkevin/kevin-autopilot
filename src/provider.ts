/**
 * provider.ts — singleton MultiProviderClient for kevin-autopilot text paths.
 *
 * Routing policy: OpenCode primary → Gemini key-pool fallback. Multiple
 * OpenCode servers can be configured via DB setting `opencode_servers`
 * (JSON array of { id, label, baseUrl }) or env OPENCODE_SERVERS
 * (comma/newline-separated URLs); legacy `opencode_url` /
 * OPENCODE_URL / OPENCODE_BASE_URL are kept as a single-server fallback.
 * When no OpenCode server is configured, the client routes directly to
 * the Gemini key-pool.
 *
 * Server password lives in env OPENCODE_SERVER_PASSWORD (canonical
 * HomeProject OpenCode deployment is no-auth, so this is usually empty).
 *
 * Scope of consumers:
 *   - ai.ts (idea analysis, free-text JSON-via-prompt)
 *   - patrol.ts (narrative briefing, free-text)
 *
 * Intentional exclusions (stay on direct Gemini / GeminiClient):
 *   - reflection.ts (uses Gemini responseSchema; ai-core GenerateParams does
 *     not expose responseSchema yet)
 *   - boost.ts / deliberation.ts / preferences.ts (schema-bound JSON; same
 *     reason)
 *   - keys.ts validateGeminiKey (validates a user-supplied specific Gemini
 *     key — must hit Gemini directly so invalid keys aren't silently masked
 *     by OpenCode primary or cross-provider fallback)
 */

import {
  GeminiProviderAdapter,
  KeyPool,
  MultiProviderClient,
  OpenCodeProviderAdapter,
} from '@kevinsisi/ai-core'
import type { ProviderAdapter, RoutePolicy } from '@kevinsisi/ai-core'
import { FileKeyStorageAdapter } from './keys.js'
import { getSetting } from './settings-store.js'
import type { AutopilotConfig } from './types.js'

const ROUTE_POLICY: RoutePolicy = {
  preferredProviders: ['opencode'],
  fallbackProviders: ['gemini'],
  allowCrossModelFallback: true,
  allowCrossProviderFallback: true,
  allowSameProviderCredentialFallback: true,
}

export const DEFAULT_OPENCODE_TEXT_MODEL = 'google/gemini-2.5-flash'
export const DEFAULT_OPENCODE_VISION_MODEL = 'google/gemini-2.5-flash'

export interface OpenCodeServer {
  id: string
  label: string
  baseUrl: string
}

let cachedClient: MultiProviderClient | null = null
let cachedSnapshot = ''

function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function normalizeServer(raw: unknown, index: number): OpenCodeServer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  const baseUrl = trimUrl(String(item.baseUrl ?? item.url ?? ''))
  if (!baseUrl) return null
  const id = String(item.id ?? '').trim() || `opencode-${index + 1}`
  const label = String(item.label ?? '').trim() || `OpenCode ${index + 1}`
  return { id, label, baseUrl }
}

function parseServers(raw: unknown): OpenCodeServer[] {
  if (Array.isArray(raw)) {
    return raw.map(normalizeServer).filter((server): server is OpenCodeServer => Boolean(server))
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parseServers(parsed)
    } catch {
      // fall through to delimiter parsing
    }
    return trimmed
      .split(/[\n,]+/)
      .map((url, index) => normalizeServer({ baseUrl: url }, index))
      .filter((server): server is OpenCodeServer => Boolean(server))
  }
  return []
}

function readEnvServers(): OpenCodeServer[] {
  const envServers = process.env.OPENCODE_SERVERS
  if (envServers && envServers.trim().length > 0) return parseServers(envServers)
  const legacy = trimUrl(process.env.OPENCODE_URL ?? process.env.OPENCODE_BASE_URL ?? '')
  if (!legacy) return []
  return [{ id: 'opencode-env', label: 'OpenCode (env)', baseUrl: legacy }]
}

export function getOpenCodeServers(config: AutopilotConfig): OpenCodeServer[] {
  const fromNewSetting = parseServers(getSetting(config, 'opencode_servers'))
  if (fromNewSetting.length > 0) return fromNewSetting
  // Back-compat: a v0.20.0 install may still have the single-URL setting.
  const legacyUrl = trimUrl(getSetting(config, 'opencode_url') ?? '')
  if (legacyUrl) return [{ id: 'opencode-legacy', label: 'OpenCode (legacy setting)', baseUrl: legacyUrl }]
  return readEnvServers()
}

export function getOpenCodeTextModel(config: AutopilotConfig): string {
  const fromSetting = getSetting(config, 'opencode_text_model')
  if (fromSetting) return fromSetting
  const fromEnv = process.env.OPENCODE_MODEL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OPENCODE_TEXT_MODEL
}

export function getOpenCodeVisionModel(config: AutopilotConfig): string {
  const fromSetting = getSetting(config, 'opencode_vision_model')
  if (fromSetting) return fromSetting
  const fromEnv = process.env.OPENCODE_VISION_MODEL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OPENCODE_VISION_MODEL
}

function readOpenCodePassword(): string {
  // Server password is env-only. The canonical HomeProject OpenCode
  // deployment (provider-amd.sisihome.org) is no-auth, so this stays
  // empty in practice; we keep the env hook for private deployments.
  return process.env.OPENCODE_SERVER_PASSWORD ?? ''
}

/**
 * True iff at least one OpenCode endpoint is configured (DB settings or
 * env). Callers use this together with `hasGeminiKeys(config)` to decide
 * whether any AI route is available before invoking
 * `getProvider().generateContent`.
 */
export function hasOpenCodeEnv(config: AutopilotConfig): boolean {
  return getOpenCodeServers(config).length > 0
}

interface BuiltAdapter {
  server: OpenCodeServer
  adapter: OpenCodeProviderAdapter
}

function buildOpenCodeAdapters(config: AutopilotConfig): BuiltAdapter[] {
  const servers = getOpenCodeServers(config)
  if (servers.length === 0) return []
  const password = readOpenCodePassword()
  return servers.map((server) => ({
    server,
    adapter: new OpenCodeProviderAdapter(
      {
        type: 'api',
        provider: 'opencode',
        apiKey: password,
        baseURL: server.baseUrl,
        credentialLabel: server.id,
      },
      {
        defaultModel: { providerID: 'google', id: 'gemini-2.5-flash' },
        basicAuth: !!password,
      },
    ),
  }))
}

/**
 * Get the singleton MultiProviderClient. Snapshot-based cache: rebuilt
 * when the resolved server list / password / autopilot dataDir change
 * (dataDir captures which Gemini key-pool DB the FileKeyStorageAdapter
 * binds to). When the admin updates settings via /api/settings/opencode,
 * the next call sees the new snapshot and rebuilds — no restart needed.
 *
 * Adapter registration order matters: every configured OpenCode server is
 * registered as an OpenCodeProviderAdapter with a distinct
 * credentialLabel. With allowSameProviderCredentialFallback enabled, the
 * router walks them in order before falling back to the Gemini key-pool.
 */
export function getProvider(config: AutopilotConfig): MultiProviderClient {
  const servers = getOpenCodeServers(config)
  const password = readOpenCodePassword()
  const signature = `${password}|${servers.map((s) => `${s.id}=${s.baseUrl}`).join('|')}|${config.dataDir}`
  if (cachedClient && cachedSnapshot === signature) return cachedClient

  const adapters: ProviderAdapter[] = []
  for (const { adapter } of buildOpenCodeAdapters(config)) adapters.push(adapter)
  adapters.push(new GeminiProviderAdapter(new KeyPool(new FileKeyStorageAdapter(config))))

  cachedClient = new MultiProviderClient({ adapters, defaultPolicy: ROUTE_POLICY })
  cachedSnapshot = signature
  return cachedClient
}

/** Force the next getProvider() call to rebuild. Call after settings change. */
export function invalidateProvider(): void {
  cachedClient = null
  cachedSnapshot = ''
}
