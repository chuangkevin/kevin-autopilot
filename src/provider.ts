/**
 * provider.ts — singleton MultiProviderClient for kevin-autopilot text paths.
 *
 * Routing policy: OpenCode primary → Gemini key-pool fallback. The OpenCode
 * server is read from OPENCODE_URL / OPENCODE_BASE_URL (+ optional
 * OPENCODE_SERVER_PASSWORD). When OpenCode is not configured, the client
 * routes directly to the Gemini key-pool (no behavior change vs the prior
 * GeminiClient-only path).
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
}

let cachedClient: MultiProviderClient | null = null
let cachedSnapshot = ''

/**
 * Resolve the OpenCode endpoint URL. Settings (DB-backed, set via
 * `/api/settings/opencode`) win over env vars so the admin can change the
 * endpoint at runtime without restarting the container; env is the
 * deploy-time fallback.
 */
function readOpenCodeUrl(config: AutopilotConfig): string {
  const fromSetting = getSetting(config, 'opencode_url')
  const fromEnv = process.env.OPENCODE_URL ?? process.env.OPENCODE_BASE_URL ?? ''
  return (fromSetting ?? fromEnv).trim().replace(/\/+$/, '')
}

function readOpenCodePassword(config: AutopilotConfig): string {
  const fromSetting = getSetting(config, 'opencode_server_password')
  const fromEnv = process.env.OPENCODE_SERVER_PASSWORD ?? ''
  return fromSetting ?? fromEnv
}

/**
 * True iff an OpenCode endpoint is configured (either via DB settings or
 * env). Callers use this together with `hasGeminiKeys(config)` to decide
 * whether at least one AI route is available before invoking
 * `getProvider().generateContent`.
 */
export function hasOpenCodeEnv(config: AutopilotConfig): boolean {
  return readOpenCodeUrl(config).length > 0
}

function buildOpenCodeAdapter(config: AutopilotConfig): OpenCodeProviderAdapter | null {
  const url = readOpenCodeUrl(config)
  if (!url) return null
  const password = readOpenCodePassword(config)
  return new OpenCodeProviderAdapter(
    {
      type: 'api',
      provider: 'opencode',
      apiKey: password,
      baseURL: url,
      credentialLabel: 'opencode-primary',
    },
    {
      defaultModel: { providerID: 'google', id: 'gemini-2.5-flash' },
      basicAuth: !!password,
    },
  )
}

/**
 * Get the singleton MultiProviderClient. Snapshot-based cache: rebuilt when
 * the resolved OpenCode URL / password / autopilot dataDir change (the
 * dataDir captures which Gemini key-pool DB the FileKeyStorageAdapter binds
 * to). DB-backed settings win over env so the admin can rotate either field
 * at runtime; the next call sees the new snapshot and rebuilds.
 */
export function getProvider(config: AutopilotConfig): MultiProviderClient {
  const url = readOpenCodeUrl(config)
  const password = readOpenCodePassword(config)
  const snapshot = `${url}|${password}|${config.dataDir}`
  if (cachedClient && cachedSnapshot === snapshot) return cachedClient

  const adapters: ProviderAdapter[] = []
  const openCode = buildOpenCodeAdapter(config)
  if (openCode) adapters.push(openCode)
  adapters.push(new GeminiProviderAdapter(new KeyPool(new FileKeyStorageAdapter(config))))

  cachedClient = new MultiProviderClient({ adapters, defaultPolicy: ROUTE_POLICY })
  cachedSnapshot = snapshot
  return cachedClient
}

/** Force the next getProvider() call to rebuild. Call after env/config changes. */
export function invalidateProvider(): void {
  cachedClient = null
  cachedSnapshot = ''
}
