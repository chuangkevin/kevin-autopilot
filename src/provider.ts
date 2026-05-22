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
import type { AutopilotConfig } from './types.js'

const ROUTE_POLICY: RoutePolicy = {
  preferredProviders: ['opencode'],
  fallbackProviders: ['gemini'],
  allowCrossModelFallback: true,
  allowCrossProviderFallback: true,
}

let cachedClient: MultiProviderClient | null = null
let cachedSnapshot = ''

function readOpenCodeUrl(): string {
  return (process.env.OPENCODE_URL ?? process.env.OPENCODE_BASE_URL ?? '').trim().replace(/\/+$/, '')
}

/**
 * True iff an OpenCode endpoint is configured in the environment. Callers
 * use this together with `hasGeminiKeys(config)` to decide whether at least
 * one AI route is available before invoking `getProvider().generateContent`.
 */
export function hasOpenCodeEnv(): boolean {
  return readOpenCodeUrl().length > 0
}

function buildOpenCodeAdapter(): OpenCodeProviderAdapter | null {
  const url = readOpenCodeUrl()
  if (!url) return null
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? ''
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
 * OPENCODE_URL / password / autopilot dataDir change (the dataDir captures
 * which Gemini key-pool DB the FileKeyStorageAdapter binds to).
 */
export function getProvider(config: AutopilotConfig): MultiProviderClient {
  const url = readOpenCodeUrl()
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? ''
  const snapshot = `${url}|${password}|${config.dataDir}`
  if (cachedClient && cachedSnapshot === snapshot) return cachedClient

  const adapters: ProviderAdapter[] = []
  const openCode = buildOpenCodeAdapter()
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
