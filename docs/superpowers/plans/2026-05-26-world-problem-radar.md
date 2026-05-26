# World Problem Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Autopilot recommendation system with a World Problem Radar that continuously surfaces structured pain-point cards from HN, Reddit, and manual paste — with no ranking, no decisions, no cost engine.

**Architecture:** Delete ~20 dead modules, strip types.ts/config.ts to minimal core, build `problem-cards.ts` (SQLite DB layer) and `radar.ts` (AI pipeline), update `external-sources.ts` (new sources), rebuild `web.ts` as a simple feed, rewire `index.ts` with a 4-hour scheduler.

**Tech Stack:** Node.js 22 ESM, TypeScript, node:sqlite (DatabaseSync), Gemini/OpenCode via existing provider, HN Algolia API, Reddit JSON API.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| DELETE | `src/thread-cost.ts` + test | cost model |
| DELETE | `src/deliberation.ts`, `src/problem-deliberation.ts` + tests | multi-agent debate |
| DELETE | `src/patrol.ts` + test | patrol chat |
| DELETE | `src/boost.ts` | AI boost |
| DELETE | `src/preferences.ts` | preference engine |
| DELETE | `src/reflection.ts` + test | AI reflection |
| DELETE | `src/backlog.ts` + test | infra backlog |
| DELETE | `src/agents.ts` + test | agent handoffs |
| DELETE | `src/handoff.ts` + test | handoff system |
| DELETE | `src/git.ts` | git observer |
| DELETE | `src/observer.ts` + test | infra observer |
| DELETE | `src/observation-loop.ts` + test | observation scheduler |
| DELETE | `src/idea-graph.ts` + test | idea graph |
| DELETE | `src/idea-quality.ts` | idea quality |
| DELETE | `src/mood.ts` | mood |
| DELETE | `src/supplements.ts` + test | supplements |
| DELETE | `src/persona.ts` | personas |
| DELETE | `src/conversation.ts` + test | patrol conversation |
| DELETE | `src/web-research.ts` + test | web research |
| DELETE | `src/graph-positions.ts` + test | graph positions |
| REWRITE | `src/types.ts` | stripped types only |
| REWRITE | `src/config.ts` | remove infra validation |
| REWRITE | `src/runtime-overrides.ts` | swap backgroundObservation → radarScan |
| REWRITE | `src/web.ts` | feed UI, no tabs |
| REWRITE | `src/web.test.ts` | new feed tests |
| REWRITE | `src/index.ts` | web + scheduler only |
| MODIFY | `src/external-sources.ts` | new HN/Reddit queries |
| MODIFY | `src/external-sources.test.ts` | update subreddit refs |
| CREATE | `src/problem-cards.ts` | DB layer (raw_signals + problem_cards) |
| CREATE | `src/problem-cards.test.ts` | DB tests |
| CREATE | `src/radar.ts` | AI pipeline |
| CREATE | `src/radar.test.ts` | pipeline tests with mocked AI |
| KEEP | `src/keys.ts`, `src/provider.ts`, `src/ai.ts` | AI pool |
| KEEP | `src/settings-store.ts`, `src/version.ts` | settings |
| KEEP | `src/config.ts` (shape only; validation simplified) | config load |
| KEEP | `src/ideas.ts`, `src/ideas.test.ts` | idea store (stripped) |

---

## Task 1: Freeze + Teardown

**Files:**
- Delete: 20 source modules + their test files (see list above)
- Rewrite: `src/index.ts` (stub)
- Rewrite: `src/web.ts` (stub)

- [ ] **Step 1: Tag the freeze point**

```bash
git tag v-autopilot-freeze
```

- [ ] **Step 2: Delete dead modules**

```bash
cd src
rm -f thread-cost.ts deliberation.ts problem-deliberation.ts patrol.ts boost.ts preferences.ts reflection.ts
rm -f backlog.ts agents.ts handoff.ts git.ts observer.ts observation-loop.ts
rm -f idea-graph.ts idea-quality.ts mood.ts supplements.ts persona.ts conversation.ts
rm -f web-research.ts graph-positions.ts ideas.ts ideas.test.ts idea-graph.test.ts
rm -f deliberation.test.ts patrol.test.ts reflection.test.ts backlog.test.ts agents.test.ts
rm -f handoff.test.ts observer.test.ts observation-loop.test.ts supplements.test.ts
rm -f conversation.test.ts web-research.test.ts graph-positions.test.ts
rm -f problem-deliberation.ts
```

- [ ] **Step 3: Rewrite `src/index.ts` to stub**

```typescript
import { loadConfig } from './config.js'
import { startWebServer } from './web.js'

const DEFAULT_CONFIG_PATH = '/config/config.json'

async function main(): Promise<void> {
  const configPath = process.env.KEVIN_AUTOPILOT_CONFIG ?? DEFAULT_CONFIG_PATH
  const config = await loadConfig(configPath)
  await startWebServer(config)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
```

- [ ] **Step 4: Rewrite `src/web.ts` to minimal stub**

```typescript
import { createServer } from 'node:http'
import type { AutopilotConfig } from './types.js'

export async function startWebServer(config: AutopilotConfig): Promise<void> {
  const port = Number(process.env.PORT ?? 3023)
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('World Problem Radar')
  })
  server.listen(port, () => console.log(`Radar on :${port} [${config.environment}]`))
  await new Promise<void>((resolve) => server.on('close', resolve))
}
```

- [ ] **Step 5: Rewrite `src/web.test.ts` to stub**

```typescript
// placeholder — real tests added in Task 8
import { describe } from 'node:test'
describe('web', () => {})
```

- [ ] **Step 6: Build — fix all remaining TS errors**

```bash
npm run build
```

Expected: 0 errors. If errors remain, trace import by import and remove dead references.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: teardown autopilot modules, stub web/index for radar rebuild"
```

---

## Task 2: Strip `types.ts`

**Files:**
- Rewrite: `src/types.ts`

- [ ] **Step 1: Write the new `src/types.ts`**

Replace the entire file with:

```typescript
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

export type ProblemSignalSourceType = 'hacker-news' | 'reddit' | 'manual'

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

export interface KeyImportSummary {
  imported: number
  skipped: number
  total: number
}

export interface KeyStatusSummary {
  total: number
  active: number
  exhausted: number
  keys: Array<{ suffix: string; status: 'active' | 'exhausted'; requestCount: number }>
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor: strip types.ts to radar-only types"
```

---

## Task 3: Strip `config.ts` and `runtime-overrides.ts`

**Files:**
- Rewrite: `src/config.ts`
- Rewrite: `src/runtime-overrides.ts`
- Modify: `src/config.test.ts`

- [ ] **Step 1: Rewrite `src/config.ts`**

```typescript
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
  if (!config.environment) throw new Error(`Missing environment in ${configPath}`)
  if (!config.dataDir) throw new Error(`Missing dataDir in ${configPath}`)
  if (config.radarScan?.intervalMs !== undefined) {
    const ms = config.radarScan.intervalMs
    if (!Number.isInteger(ms) || ms < 60_000) throw new Error(`radarScan.intervalMs must be >= 60000 in ${configPath}`)
  }
}
```

- [ ] **Step 2: Rewrite `src/runtime-overrides.ts`**

```typescript
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
    const fieldSchema = schema[dotKey]
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
```

- [ ] **Step 3: Update `src/config.test.ts`** — remove all tests referencing `ruleSources`, `repositories`, `services`, `backgroundObservation`, `webResearch`. Keep only environment/dataDir/radarScan validation tests.

Read the file first, then replace the body with:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, tmpdir } from 'node:path'
import { loadConfig } from './config.js'

test('loadConfig validates required fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-cfg-'))
  try {
    const cfgPath = join(dir, 'config.json')
    await writeFile(cfgPath, JSON.stringify({}))
    await assert.rejects(() => loadConfig(cfgPath), /Missing environment/)

    await writeFile(cfgPath, JSON.stringify({ environment: 'test' }))
    await assert.rejects(() => loadConfig(cfgPath), /Missing dataDir/)

    await writeFile(cfgPath, JSON.stringify({ environment: 'test', dataDir: dir }))
    const cfg = await loadConfig(cfgPath)
    assert.equal(cfg.environment, 'test')
    assert.equal(cfg.dataDir, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadConfig validates radarScan.intervalMs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-cfg-'))
  try {
    const cfgPath = join(dir, 'config.json')
    await writeFile(cfgPath, JSON.stringify({ environment: 'test', dataDir: dir, radarScan: { intervalMs: 100 } }))
    await assert.rejects(() => loadConfig(cfgPath), /intervalMs/)

    await writeFile(cfgPath, JSON.stringify({ environment: 'test', dataDir: dir, radarScan: { intervalMs: 3_600_000 } }))
    const cfg = await loadConfig(cfgPath)
    assert.equal(cfg.radarScan?.intervalMs, 3_600_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 4: Build + test**

```bash
npm run build && npm test 2>&1 | grep -E "^(# tests|# pass|# fail|not ok)"
```

Expected: all pass (now far fewer tests than before).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts src/runtime-overrides.ts
git commit -m "refactor: strip config and runtime-overrides to radar schema"
```

---

## Task 4: Create `problem-cards.ts` (DB Layer)

**Files:**
- Create: `src/problem-cards.ts`
- Create: `src/problem-cards.test.ts`

- [ ] **Step 1: Write the failing test `src/problem-cards.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, tmpdir } from 'node:path'
import { openRadarDatabase, upsertRawSignal, listPendingSignals, markSignalProcessed, insertProblemCard, listProblemCards, makeSignalId, makeCardId } from './problem-cards.js'
import type { AutopilotConfig, ProblemCard, ProblemSignal } from './types.js'

function testConfig(dataDir: string): AutopilotConfig {
  return { environment: 'test', dataDir }
}

const testSignal = (): ProblemSignal => ({
  id: makeSignalId('hacker-news', 'hn:123', 'Test title'),
  sourceType: 'hacker-news',
  sourceName: 'hn:123',
  title: 'Test title',
  snippet: 'A real pain point about manual work',
  url: 'https://news.ycombinator.com/item?id=123',
  fetchedAt: new Date().toISOString(),
})

test('openRadarDatabase creates tables idempotently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-db-'))
  try {
    const db = openRadarDatabase(testConfig(dir))
    openRadarDatabase(testConfig(dir)) // idempotent
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('upsertRawSignal inserts and deduplicates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-db-'))
  try {
    const db = openRadarDatabase(testConfig(dir))
    const signal = testSignal()
    upsertRawSignal(db, signal)
    upsertRawSignal(db, signal) // second insert should not throw
    const pending = listPendingSignals(db)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].id, signal.id)
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('markSignalProcessed updates status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-db-'))
  try {
    const db = openRadarDatabase(testConfig(dir))
    const signal = testSignal()
    upsertRawSignal(db, signal)
    markSignalProcessed(db, signal.id, 'done')
    const pending = listPendingSignals(db)
    assert.equal(pending.length, 0)
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('insertProblemCard and listProblemCards round-trip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-db-'))
  try {
    const db = openRadarDatabase(testConfig(dir))
    const signal = testSignal()
    const card: ProblemCard = {
      id: makeCardId(signal.id),
      signalId: signal.id,
      whoIsInPain: 'backend engineers',
      pain: '手動部署耗時',
      context: '團隊規模快速擴張時',
      currentWorkaround: '自己寫 rollback script',
      urgencySignal: '系統規模超過單人能管理的範圍',
      ideaSeeds: ['drift detection tool', 'auto rollback agent'],
      sourceUrl: signal.url,
      createdAt: new Date().toISOString(),
    }
    insertProblemCard(db, card)
    const cards = listProblemCards(db)
    assert.equal(cards.length, 1)
    assert.equal(cards[0].whoIsInPain, 'backend engineers')
    assert.deepEqual(cards[0].ideaSeeds, ['drift detection tool', 'auto rollback agent'])
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | grep error
```

Expected: `Cannot find module './problem-cards.js'`

- [ ] **Step 3: Create `src/problem-cards.ts`**

```typescript
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { AutopilotConfig, ProblemCard, ProblemSignal } from './types.js'

const DB_FILE = 'radar.db'

export function makeSignalId(sourceType: string, sourceName: string, title: string): string {
  const hash = createHash('sha256')
    .update([sourceType, sourceName, title.slice(0, 120)].join('\x00'))
    .digest('hex')
    .slice(0, 12)
  return `sig-${hash}`
}

export function makeCardId(signalId: string): string {
  return `card-${signalId.slice(4)}`
}

export function openRadarDatabase(config: AutopilotConfig): DatabaseSync {
  const db = new DatabaseSync(join(config.dataDir, DB_FILE))
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_signals (
      id          TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      title       TEXT NOT NULL,
      snippet     TEXT NOT NULL,
      url         TEXT,
      fetched_at  TEXT NOT NULL,
      processed   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS problem_cards (
      id                TEXT PRIMARY KEY,
      signal_id         TEXT NOT NULL,
      who_is_in_pain    TEXT NOT NULL,
      pain              TEXT NOT NULL,
      context           TEXT NOT NULL,
      current_workaround TEXT NOT NULL,
      urgency_signal    TEXT NOT NULL,
      idea_seeds        TEXT NOT NULL DEFAULT '[]',
      source_url        TEXT,
      created_at        TEXT NOT NULL
    );
  `)
  return db
}

export function upsertRawSignal(db: DatabaseSync, signal: ProblemSignal): void {
  db.prepare(`
    INSERT OR IGNORE INTO raw_signals (id, source_type, source_name, title, snippet, url, fetched_at, processed)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(signal.id, signal.sourceType, signal.sourceName, signal.title, signal.snippet, signal.url ?? null, signal.fetchedAt)
}

export function listPendingSignals(db: DatabaseSync): ProblemSignal[] {
  const rows = db.prepare(`
    SELECT id, source_type, source_name, title, snippet, url, fetched_at
    FROM raw_signals WHERE processed = 0 ORDER BY fetched_at ASC
  `).all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id),
    sourceType: String(r.source_type) as ProblemSignal['sourceType'],
    sourceName: String(r.source_name),
    title: String(r.title),
    snippet: String(r.snippet),
    url: r.url ? String(r.url) : undefined,
    fetchedAt: String(r.fetched_at),
  }))
}

export function markSignalProcessed(db: DatabaseSync, id: string, status: 'done' | 'skipped'): void {
  db.prepare(`UPDATE raw_signals SET processed = ? WHERE id = ?`).run(status === 'done' ? 1 : 2, id)
}

export function insertProblemCard(db: DatabaseSync, card: ProblemCard): void {
  db.prepare(`
    INSERT OR REPLACE INTO problem_cards
      (id, signal_id, who_is_in_pain, pain, context, current_workaround, urgency_signal, idea_seeds, source_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    card.id, card.signalId, card.whoIsInPain, card.pain, card.context,
    card.currentWorkaround, card.urgencySignal, JSON.stringify(card.ideaSeeds),
    card.sourceUrl ?? null, card.createdAt,
  )
}

export function listProblemCards(db: DatabaseSync, options: { limit?: number; offset?: number } = {}): ProblemCard[] {
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0
  const rows = db.prepare(`
    SELECT id, signal_id, who_is_in_pain, pain, context, current_workaround,
           urgency_signal, idea_seeds, source_url, created_at
    FROM problem_cards ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id),
    signalId: String(r.signal_id),
    whoIsInPain: String(r.who_is_in_pain),
    pain: String(r.pain),
    context: String(r.context),
    currentWorkaround: String(r.current_workaround),
    urgencySignal: String(r.urgency_signal),
    ideaSeeds: JSON.parse(String(r.idea_seeds)) as string[],
    sourceUrl: r.source_url ? String(r.source_url) : undefined,
    createdAt: String(r.created_at),
  }))
}
```

- [ ] **Step 4: Build + test**

```bash
npm run build && npm test -- --test-name-pattern="openRadarDatabase|upsertRaw|markSignal|insertProblem" 2>&1 | grep -E "(ok|not ok|pass|fail)"
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/problem-cards.ts src/problem-cards.test.ts
git commit -m "feat: problem-cards DB layer (raw_signals + problem_cards)"
```

---

## Task 5: Update `external-sources.ts`

**Files:**
- Modify: `src/external-sources.ts`
- Modify: `src/external-sources.test.ts`

- [ ] **Step 1: Replace `src/external-sources.ts`**

```typescript
import { makeSignalId } from './problem-cards.js'
import type { ProblemSignal } from './types.js'

const HN_BASE = 'https://hn.algolia.com/api/v1/search'
const HN_TAGS: Array<'show_hn' | 'ask_hn'> = ['show_hn', 'ask_hn']
const REDDIT_SUBREDDITS = ['programming', 'ExperiencedDevs', 'SaaS', 'startups']
const REDDIT_AGENT = 'world-problem-radar/1.0 (personal research tool)'

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\s+/g, ' ').trim()
}

export async function fetchHackerNewsSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const timeout = options.timeout ?? 10_000
  const signals: ProblemSignal[] = []
  const fetchedAt = new Date().toISOString()
  for (const tag of HN_TAGS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const res = await fetch(`${HN_BASE}?tags=${tag}&hitsPerPage=30`, { signal: ctrl.signal })
        if (!res.ok) continue
        const data = await res.json() as { hits?: unknown[] }
        for (const hit of data.hits ?? []) {
          const h = hit as Record<string, unknown>
          const text = stripHtml([String(h.story_text ?? ''), String(h.comment_text ?? '')].filter(Boolean).join(' ').trim())
          if (text.length < 80) continue
          const title = stripHtml(String(h.title ?? '')).slice(0, 180)
          if (!title) continue
          const sourceName = `hn:${String(h.objectID ?? 'unknown')}`
          signals.push({
            id: makeSignalId('hacker-news', sourceName, title),
            sourceType: 'hacker-news',
            sourceName,
            title,
            snippet: text.slice(0, 1200),
            url: `https://news.ycombinator.com/item?id=${String(h.objectID ?? '')}`,
            fetchedAt,
          })
        }
      } finally {
        clearTimeout(timer)
      }
    } catch { /* per-tag failure: ignore */ }
  }
  return signals
}

export async function fetchRedditSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const timeout = options.timeout ?? 10_000
  const signals: ProblemSignal[] = []
  const fetchedAt = new Date().toISOString()
  for (const sub of REDDIT_SUBREDDITS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=25`, {
          signal: ctrl.signal,
          headers: { 'User-Agent': REDDIT_AGENT },
        })
        if (!res.ok) continue
        const data = await res.json() as { data?: { children?: unknown[] } }
        for (const child of data.data?.children ?? []) {
          const post = (child as { data?: Record<string, unknown> }).data
          if (!post) continue
          const text = String(post.selftext ?? '').trim()
          if (text.length < 80) continue
          const title = String(post.title ?? '').slice(0, 180)
          const sourceName = `reddit:${sub}:${String(post.id ?? 'unknown')}`
          signals.push({
            id: makeSignalId('reddit', sourceName, title),
            sourceType: 'reddit',
            sourceName,
            title,
            snippet: text.slice(0, 1200),
            url: `https://www.reddit.com${String(post.permalink ?? '')}`,
            fetchedAt,
          })
        }
      } finally {
        clearTimeout(timer)
      }
    } catch { /* per-subreddit failure: ignore */ }
  }
  return signals
}

export async function fetchExternalSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const [hn, reddit] = await Promise.all([
    fetchHackerNewsSignals(options).catch((): ProblemSignal[] => []),
    fetchRedditSignals(options).catch((): ProblemSignal[] => []),
  ])
  return [...hn, ...reddit]
}
```

- [ ] **Step 2: Update `src/external-sources.test.ts`** — replace any references to old subreddits (`smallbusiness`, `freelance`, `productivity`, `SideProject`) with the new ones (`SaaS`, `startups`, `programming`, `ExperiencedDevs`). Replace `createProblemSignal` with `makeSignalId`. Verify the test still compiles.

```bash
npm run build
```

- [ ] **Step 3: Run external-sources tests**

```bash
npm test -- --test-name-pattern="external" 2>&1 | grep -E "(ok|not ok)"
```

- [ ] **Step 4: Commit**

```bash
git add src/external-sources.ts src/external-sources.test.ts
git commit -m "feat: update external-sources — Show/Ask HN, new Reddit subreddits"
```

---

## Task 6: Create `radar.ts` (AI Pipeline)

**Files:**
- Create: `src/radar.ts`
- Create: `src/radar.test.ts`

- [ ] **Step 1: Write failing tests `src/radar.test.ts`**

```typescript
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, tmpdir } from 'node:path'
import { makeSignalId, openRadarDatabase, listProblemCards, listPendingSignals } from './problem-cards.js'
import { runRadarPipeline } from './radar.js'
import type { AutopilotConfig, ProblemSignal } from './types.js'

function testConfig(dataDir: string): AutopilotConfig {
  return {
    environment: 'test',
    dataDir,
    ai: { enabled: true, provider: 'gemini', model: 'gemini-2.0-flash' },
  }
}

const signal: ProblemSignal = {
  id: makeSignalId('hacker-news', 'hn:1', 'Why is k8s so painful'),
  sourceType: 'hacker-news',
  sourceName: 'hn:1',
  title: 'Why is k8s so painful',
  snippet: 'I spend 3 hours every day manually fixing config drift. There has to be a better way. Our workaround is a bash script that we update by hand.',
  url: 'https://news.ycombinator.com/item?id=1',
  fetchedAt: new Date().toISOString(),
}

test('runRadarPipeline: AI disabled — signals stored, no cards created', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-pipe-'))
  try {
    const config: AutopilotConfig = { environment: 'test', dataDir: dir }
    const db = openRadarDatabase(config)
    await runRadarPipeline(config, db, [signal])
    const cards = listProblemCards(db)
    assert.equal(cards.length, 0)
    const pending = listPendingSignals(db)
    assert.equal(pending.length, 0) // skipped because AI disabled
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runRadarPipeline: AI enabled, provider mocked — card created', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-pipe-'))
  try {
    const config = testConfig(dir)

    // Mock the provider module
    const mockCard = {
      who_is_in_pain: 'DevOps engineers',
      pain: '手動修復配置漂移耗時',
      context: '大型 k8s 叢集快速擴展時',
      current_workaround: '手動維護 bash script',
      urgency_signal: '團隊規模超過單人可管理',
    }
    const mockSeeds = ['drift detection system', 'config audit tool']

    // Use dependency injection — pass a mock provider
    const mockProvider = {
      generateContent: mock.fn(async ({ prompt }: { prompt: string }) => {
        if (prompt.includes('{"keep"')) {
          return { text: '{"keep":true}' }
        }
        if (prompt.includes('who_is_in_pain')) {
          return { text: JSON.stringify(mockCard) }
        }
        return { text: JSON.stringify(mockSeeds) }
      }),
    }

    const db = openRadarDatabase(config)
    await runRadarPipeline(config, db, [signal], mockProvider as never)
    const cards = listProblemCards(db)
    assert.equal(cards.length, 1)
    assert.equal(cards[0].whoIsInPain, 'DevOps engineers')
    assert.deepEqual(cards[0].ideaSeeds, mockSeeds)
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | grep error
```

Expected: `Cannot find module './radar.js'`

- [ ] **Step 3: Create `src/radar.ts`**

```typescript
import { makeCardId, insertProblemCard, markSignalProcessed, upsertRawSignal } from './problem-cards.js'
import { getProvider, hasOpenCodeEnv } from './provider.js'
import { hasGeminiKeys } from './keys.js'
import type { AutopilotConfig, ProblemCard, ProblemSignal } from './types.js'
import type { DatabaseSync } from 'node:sqlite'

const EXTRACT_TIMEOUT_MS = 15_000
const STRUCTURE_TIMEOUT_MS = 20_000

interface AiProvider {
  generateContent(opts: { model: string; maxOutputTokens: number; systemInstruction: string; prompt: string }): Promise<{ text: string }>
}

function parseJson<T>(text: string): T | null {
  try {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) as T : null
  } catch {
    return null
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('radar: timeout')), ms)),
  ])
}

async function extractSignal(config: AutopilotConfig, signal: ProblemSignal, provider: AiProvider): Promise<boolean> {
  const model = config.ai!.model
  const prompt = `Analyze this post. Reply ONLY with JSON: {"keep":true} or {"keep":false}

Keep if: someone is frustrated with a workflow, manual process, broken tool, or wasted time.
Skip if: pure tech discussion, job post, news headline, self-promotion, or no human pain.

Title: ${signal.title}
Text: ${signal.snippet.slice(0, 600)}`

  try {
    const result = await withTimeout(
      provider.generateContent({ model, maxOutputTokens: 32, systemInstruction: 'You are a pain signal classifier. Reply only with JSON.', prompt }),
      EXTRACT_TIMEOUT_MS,
    )
    const parsed = parseJson<{ keep: boolean }>(result.text)
    return parsed?.keep === true
  } catch {
    return false
  }
}

async function structureCard(config: AutopilotConfig, signal: ProblemSignal, provider: AiProvider): Promise<Omit<ProblemCard, 'id' | 'signalId' | 'sourceUrl' | 'createdAt' | 'ideaSeeds'> | null> {
  const model = config.ai!.model
  const prompt = `Extract a structured problem card. Reply ONLY with JSON.

Title: ${signal.title}
Text: ${signal.snippet.slice(0, 800)}

JSON schema:
{
  "who_is_in_pain": "specific group in English (e.g. 'startup founders', 'backend engineers')",
  "pain": "核心痛點（繁體中文）",
  "context": "在什麼情境下發生（繁體中文）",
  "current_workaround": "現在怎麼應對（繁體中文）",
  "urgency_signal": "為什麼現在這個問題浮現（繁體中文）"
}

Rules: who_is_in_pain in English only. All other fields in Chinese. No judgment. No scoring.`

  try {
    const result = await withTimeout(
      provider.generateContent({ model, maxOutputTokens: 512, systemInstruction: 'You extract structured problem cards. Reply only with JSON.', prompt }),
      STRUCTURE_TIMEOUT_MS,
    )
    const parsed = parseJson<Record<string, string>>(result.text)
    if (!parsed || !parsed.who_is_in_pain || !parsed.pain) return null
    return {
      whoIsInPain: String(parsed.who_is_in_pain),
      pain: String(parsed.pain),
      context: String(parsed.context ?? ''),
      currentWorkaround: String(parsed.current_workaround ?? ''),
      urgencySignal: String(parsed.urgency_signal ?? ''),
    }
  } catch {
    return null
  }
}

async function generateIdeaSeeds(config: AutopilotConfig, card: Omit<ProblemCard, 'id' | 'signalId' | 'sourceUrl' | 'createdAt' | 'ideaSeeds'>, provider: AiProvider): Promise<string[]> {
  const model = config.ai!.model
  const prompt = `List 2-4 possible product directions. No scoring, no ranking, no "best".

Who: ${card.whoIsInPain}
Pain: ${card.pain}
Context: ${card.context}

Reply ONLY with a JSON array of short strings. Example: ["direction A", "direction B"]`

  try {
    const result = await withTimeout(
      provider.generateContent({ model, maxOutputTokens: 256, systemInstruction: 'You generate product direction ideas. Reply only with a JSON array of strings.', prompt }),
      STRUCTURE_TIMEOUT_MS,
    )
    const parsed = parseJson<string[]>(result.text)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string').slice(0, 4) : []
  } catch {
    return []
  }
}

export async function runRadarPipeline(
  config: AutopilotConfig,
  db: DatabaseSync,
  signals: ProblemSignal[],
  providerOverride?: AiProvider,
): Promise<ProblemCard[]> {
  const aiEnabled = config.ai?.enabled && (providerOverride ?? (hasOpenCodeEnv(config) || await hasGeminiKeys(config).catch(() => false)))
  const provider = providerOverride ?? (aiEnabled ? getProvider(config) : null)
  const cards: ProblemCard[] = []

  for (const signal of signals) {
    upsertRawSignal(db, signal)
    if (!provider) {
      markSignalProcessed(db, signal.id, 'skipped')
      continue
    }

    const keep = await extractSignal(config, signal, provider)
    if (!keep) {
      markSignalProcessed(db, signal.id, 'skipped')
      continue
    }

    const structured = await structureCard(config, signal, provider)
    if (!structured) {
      markSignalProcessed(db, signal.id, 'skipped')
      continue
    }

    const seeds = await generateIdeaSeeds(config, structured, provider)
    const card: ProblemCard = {
      id: makeCardId(signal.id),
      signalId: signal.id,
      ...structured,
      ideaSeeds: seeds,
      sourceUrl: signal.url,
      createdAt: new Date().toISOString(),
    }

    insertProblemCard(db, card)
    markSignalProcessed(db, signal.id, 'done')
    cards.push(card)
  }

  return cards
}
```

- [ ] **Step 4: Build + test**

```bash
npm run build && npm test -- --test-name-pattern="runRadarPipeline" 2>&1 | grep -E "(ok|not ok|pass|fail)"
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/radar.ts src/radar.test.ts
git commit -m "feat: radar AI pipeline — extract, structure, idea seeds"
```

---

## Task 7: Rebuild `web.ts`

**Files:**
- Rewrite: `src/web.ts`
- Rewrite: `src/web.test.ts`

- [ ] **Step 1: Write failing tests `src/web.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, tmpdir } from 'node:path'
import { once } from 'node:events'
import { createWebServer } from './web.js'
import type { AutopilotConfig } from './types.js'

test('GET / returns feed page', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'radar-web-'))
  const config: AutopilotConfig = { environment: 'test', dataDir }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const base = `http://127.0.0.1:${address.port}`

    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0')
    const body = await res.text()
    assert.ok(body.includes('WORLD PROBLEM RADAR'))
    assert.ok(body.includes('PROBLEM FEED'))
    assert.ok(body.includes('paste-input'))
    assert.ok(body.includes('Scan Now'))
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('GET /health returns JSON', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'radar-web-'))
  const config: AutopilotConfig = { environment: 'test', dataDir }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const res = await fetch(`http://127.0.0.1:${address.port}/health`)
    assert.equal(res.status, 200)
    const body = await res.json() as { environment: string }
    assert.equal(body.environment, 'test')
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('GET /api/radar/cards returns JSON array', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'radar-web-'))
  const config: AutopilotConfig = { environment: 'test', dataDir }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const res = await fetch(`http://127.0.0.1:${address.port}/api/radar/cards`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body))
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('POST /api/radar/paste ingest manual signal', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'radar-web-'))
  const config: AutopilotConfig = { environment: 'test', dataDir }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const base = `http://127.0.0.1:${address.port}`
    const res = await fetch(`${base}/api/radar/paste`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '每次 deploy 都要手動改設定，浪費很多時間' }),
    })
    assert.equal(res.status, 202)
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | grep error | head -5
```

Expected: errors because `createWebServer` not exported from web.ts.

- [ ] **Step 3: Rewrite `src/web.ts`**

```typescript
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { getKeyStatus, importGeminiKeys, clearStoredGeminiKeys } from './keys.js'
import { loadRuntimeOverrides, saveRuntimeOverrides, RUNTIME_OVERRIDE_SCHEMA, RuntimeOverrideError, getEffectiveConfig } from './runtime-overrides.js'
import { openRadarDatabase, listProblemCards, upsertRawSignal, makeSignalId } from './problem-cards.js'
import { fetchExternalSignals } from './external-sources.js'
import { runRadarPipeline } from './radar.js'
import { APP_VERSION } from './version.js'
import type { AutopilotConfig, ProblemCard } from './types.js'

const DEFAULT_PORT = 3023
const MAX_BODY_BYTES = 32 * 1024
const NO_STORE = { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache', expires: '0' }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) { req.destroy(); reject(new Error('body too large')); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { ...NO_STORE, 'content-type': 'application/json' })
  res.end(body)
}

function renderCard(card: ProblemCard): string {
  const sourceLabel = card.signalId.includes('reddit') ? 'reddit' : card.signalId.includes('manual') ? 'manual' : 'hn'
  const date = card.createdAt.slice(0, 16).replace('T', ' ')
  const seedsHtml = card.ideaSeeds.length > 0
    ? `<div class="idea-seeds">
        <div class="idea-seeds-toggle" onclick="toggleSeeds(this)">▾ Possible directions</div>
        <ul class="idea-seeds-list">${card.ideaSeeds.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
       </div>`
    : ''
  return `<div class="card">
  <div class="card-meta">
    <span class="card-source">${escapeHtml(sourceLabel)}</span>
    <span>${escapeHtml(date)}</span>
    ${card.sourceUrl ? `<a href="${escapeAttr(card.sourceUrl)}" target="_blank" rel="noopener" style="color:#6366f1;text-decoration:none">→ source</a>` : ''}
  </div>
  <div class="card-row"><span class="card-key">Who</span><span class="card-val">${escapeHtml(card.whoIsInPain)}</span></div>
  <div class="card-row"><span class="card-key">Pain</span><span class="card-val">${escapeHtml(card.pain)}</span></div>
  <div class="card-row"><span class="card-key">Context</span><span class="card-val">${escapeHtml(card.context)}</span></div>
  <div class="card-row"><span class="card-key">Workaround</span><span class="card-val">${escapeHtml(card.currentWorkaround)}</span></div>
  <div class="card-row"><span class="card-key">Why now</span><span class="card-val">${escapeHtml(card.urgencySignal)}</span></div>
  ${seedsHtml}
</div>`
}

function renderPage(cards: ProblemCard[]): string {
  const cardsHtml = cards.length > 0
    ? cards.map(renderCard).join('\n')
    : '<div class="empty">// 尚無問題卡片 — 點「Scan Now」或貼上文字</div>'
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>World Problem Radar</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#e2e8f0;font-family:'Courier New',monospace;min-height:100vh}
header{padding:16px 24px;border-bottom:1px solid rgba(148,163,184,.15);display:flex;justify-content:space-between;align-items:center}
.logo{font-size:14px;font-weight:700;letter-spacing:.12em;color:#6366f1}
.scan-btn{background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.4);color:#a5b4fc;padding:8px 18px;border-radius:10px;font-size:13px;cursor:pointer;font-family:inherit}
.scan-btn:hover{background:rgba(99,102,241,.25)}
main{max-width:780px;margin:0 auto;padding:24px 16px}
.paste-bar{display:flex;gap:8px;margin-bottom:24px}
.paste-input{flex:1;background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.2);border-radius:12px;padding:12px 16px;color:#e2e8f0;font-size:14px;font-family:inherit;min-width:0}
.paste-input::placeholder{color:#334155}
.paste-btn{background:rgba(30,27,75,.4);border:1px solid rgba(99,102,241,.4);border-radius:12px;color:#a5b4fc;font-size:13px;padding:12px 18px;cursor:pointer;white-space:nowrap;font-family:inherit}
.feed-label{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
.feed{display:flex;flex-direction:column;gap:12px}
.card{background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.12);border-radius:16px;padding:18px 20px}
.card-meta{font-size:11px;color:#475569;margin-bottom:12px;display:flex;gap:12px;align-items:center}
.card-source{color:#6366f1}
.card-row{display:grid;grid-template-columns:90px 1fr;gap:4px 12px;font-size:13px;margin-bottom:6px}
.card-key{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding-top:2px}
.card-val{color:#cbd5e1;line-height:1.5}
.idea-seeds{margin-top:12px}
.idea-seeds-toggle{font-size:12px;color:#475569;cursor:pointer;user-select:none;padding:4px 0}
.idea-seeds-list{display:none;margin-top:6px;padding-left:14px}
.idea-seeds-list li{font-size:13px;color:#94a3b8;line-height:1.6}
.empty{text-align:center;padding:60px 0;color:#475569;font-size:14px}
</style>
</head>
<body>
<header>
  <div class="logo">/// WORLD PROBLEM RADAR</div>
  <button class="scan-btn" onclick="triggerScan(this)">Scan Now</button>
</header>
<main>
  <div class="paste-bar">
    <input class="paste-input" id="paste-input" placeholder="貼上任何文字作為問題訊號…" />
    <button class="paste-btn" onclick="submitPaste()">送出</button>
  </div>
  <div class="feed-label">// PROBLEM FEED</div>
  <div class="feed">${cardsHtml}</div>
</main>
<script>
async function triggerScan(btn){
  btn.disabled=true;btn.textContent='Scanning…';
  try{await fetch('/api/radar/scan',{method:'POST'});location.reload()}
  catch{btn.textContent='Error';setTimeout(()=>{btn.disabled=false;btn.textContent='Scan Now'},2000)}
}
async function submitPaste(){
  var input=document.getElementById('paste-input');
  var text=input.value.trim();if(!text)return;
  await fetch('/api/radar/paste',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
  input.value='';location.reload();
}
function toggleSeeds(el){
  var list=el.nextElementSibling;if(!list)return;
  var open=list.style.display==='block';
  list.style.display=open?'none':'block';
  el.textContent=open?'▾ Possible directions':'▴ Possible directions';
}
</script>
</body>
</html>`
}

export function createWebServer(config: AutopilotConfig): Server {
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    try {
      if (method === 'GET' && url === '/health') {
        return json(res, 200, { status: 'ok', version: APP_VERSION, environment: config.environment })
      }

      if (method === 'GET' && (url === '/' || url === '/index.html')) {
        const db = openRadarDatabase(config)
        const cards = listProblemCards(db, { limit: 50 })
        db.close()
        res.writeHead(200, { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' })
        return res.end(renderPage(cards))
      }

      if (method === 'GET' && url === '/api/radar/cards') {
        const db = openRadarDatabase(config)
        const cards = listProblemCards(db, { limit: 50 })
        db.close()
        return json(res, 200, cards)
      }

      if (method === 'POST' && url === '/api/radar/scan') {
        // Fire-and-forget background scan
        void (async () => {
          try {
            const effective = await getEffectiveConfig(config)
            const signals = await fetchExternalSignals()
            const db = openRadarDatabase(effective)
            await runRadarPipeline(effective, db, signals)
            db.close()
          } catch { /* ignore */ }
        })()
        return json(res, 202, { status: 'scan started' })
      }

      if (method === 'POST' && url === '/api/radar/paste') {
        const body = await readBody(req)
        const parsed = JSON.parse(body) as { text?: string }
        const text = String(parsed.text ?? '').trim()
        if (text.length < 10) return json(res, 400, { error: 'text too short' })

        const id = makeSignalId('manual', `manual:${createHash('sha256').update(text).digest('hex').slice(0, 8)}`, text.slice(0, 120))
        const db = openRadarDatabase(config)
        upsertRawSignal(db, {
          id,
          sourceType: 'manual',
          sourceName: 'manual',
          title: text.slice(0, 120),
          snippet: text.slice(0, 1200),
          fetchedAt: new Date().toISOString(),
        })
        db.close()

        // Fire-and-forget AI structuring
        void (async () => {
          try {
            const effective = await getEffectiveConfig(config)
            const db2 = openRadarDatabase(effective)
            await runRadarPipeline(effective, db2, [{
              id, sourceType: 'manual', sourceName: 'manual',
              title: text.slice(0, 120), snippet: text.slice(0, 1200),
              fetchedAt: new Date().toISOString(),
            }])
            db2.close()
          } catch { /* ignore */ }
        })()
        return json(res, 202, { status: 'signal ingested' })
      }

      if (method === 'GET' && url.startsWith('/api/keys')) {
        const status = await getKeyStatus(config)
        return json(res, 200, status)
      }

      if (method === 'POST' && url === '/api/keys/import') {
        const body = await readBody(req)
        const { keys } = JSON.parse(body) as { keys?: string }
        if (!keys) return json(res, 400, { error: 'missing keys' })
        const summary = await importGeminiKeys(config, keys)
        return json(res, 200, summary)
      }

      if (method === 'POST' && url === '/api/keys/clear') {
        const status = await clearStoredGeminiKeys(config)
        return json(res, 200, status)
      }

      if (method === 'GET' && url === '/api/runtime-overrides') {
        const overrides = await loadRuntimeOverrides(config)
        return json(res, 200, { overrides, schema: RUNTIME_OVERRIDE_SCHEMA })
      }

      if (method === 'POST' && url === '/api/runtime-overrides') {
        const body = await readBody(req)
        const data = JSON.parse(body)
        const saved = await saveRuntimeOverrides(config, data)
        return json(res, 200, saved)
      }

      json(res, 404, { error: 'not found' })
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  })
  return server
}

export async function startWebServer(config: AutopilotConfig): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT)
  const server = createWebServer(config)
  server.listen(port, () => console.log(`World Problem Radar on :${port} [${config.environment}]`))
  await new Promise<void>((resolve) => server.on('close', resolve))
}
```

- [ ] **Step 4: Build + test**

```bash
npm run build && npm test -- --test-name-pattern="GET /|GET /health|GET /api/radar|POST /api/radar" 2>&1 | grep -E "(ok|not ok|pass|fail)"
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web.ts src/web.test.ts
git commit -m "feat: rebuild web.ts as World Problem Radar feed"
```

---

## Task 8: Rewire `index.ts` with Scheduler

**Files:**
- Rewrite: `src/index.ts`

- [ ] **Step 1: Rewrite `src/index.ts`**

```typescript
import { loadConfig } from './config.js'
import { startWebServer } from './web.js'
import { getEffectiveConfig } from './runtime-overrides.js'
import { fetchExternalSignals } from './external-sources.js'
import { openRadarDatabase } from './problem-cards.js'
import { runRadarPipeline } from './radar.js'
import { APP_VERSION } from './version.js'

const DEFAULT_CONFIG_PATH = '/config/config.json'
const DEFAULT_SCAN_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

async function runScan(configPath: string): Promise<void> {
  try {
    const baseConfig = await loadConfig(configPath)
    const config = await getEffectiveConfig(baseConfig)
    console.log(`[radar] scan start — ${new Date().toISOString()}`)
    const signals = await fetchExternalSignals()
    console.log(`[radar] fetched ${signals.length} signals`)
    const db = openRadarDatabase(config)
    const cards = await runRadarPipeline(config, db, signals)
    db.close()
    console.log(`[radar] ${cards.length} new cards created`)
  } catch (err) {
    console.error('[radar] scan error:', err instanceof Error ? err.message : String(err))
  }
}

async function main(): Promise<void> {
  const configPath = process.env.KEVIN_AUTOPILOT_CONFIG ?? DEFAULT_CONFIG_PATH
  const config = await loadConfig(configPath)
  const effective = await getEffectiveConfig(config)

  console.log(`World Problem Radar v${APP_VERSION} [${config.environment}]`)

  const intervalMs = effective.radarScan?.intervalMs ?? DEFAULT_SCAN_INTERVAL_MS
  console.log(`[radar] background scan every ${intervalMs / 60_000} min`)

  // Initial scan on startup
  void runScan(configPath)

  // Recurring background scan
  setInterval(() => void runScan(configPath), intervalMs)

  // Start web server (blocks until server closes)
  await startWebServer(config)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | grep -E "^(# tests|# pass|# fail|not ok)"
```

Expected: all pass, no failures.

- [ ] **Step 4: Commit + push**

```bash
git add src/index.ts
git commit -m "feat: wire scheduler (4h) + startup scan into index.ts"
git push origin main
```

---

## Task 9: Wipe Old DB + Verify End-to-End

**Files:**
- No code changes — operational step

- [ ] **Step 1: Backup old SQLite on the server**

SSH to the server and run:
```bash
cp /data/kevin-autopilot/*.db /data/kevin-autopilot/backup-autopilot-$(date +%Y%m%d).db 2>/dev/null || true
cp /data/kevin-autopilot/daily-problem-pick.json /data/kevin-autopilot/backup-daily-pick-$(date +%Y%m%d).json 2>/dev/null || true
```

- [ ] **Step 2: Remove old DB files (new schema auto-creates on first start)**

```bash
rm -f /data/kevin-autopilot/*.db
rm -f /data/kevin-autopilot/daily-problem-pick.json
rm -f /data/kevin-autopilot/problem-briefs-*.json
```

- [ ] **Step 3: Wait for CI/CD deploy to complete**

Check CI/CD workflow in GitHub Actions. Confirm the deploy succeeded.

- [ ] **Step 4: Trigger a manual scan and verify**

```bash
curl -s -X POST http://100.83.112.20:3023/api/radar/scan
```

Expected: `{"status":"scan started"}`

- [ ] **Step 5: Check cards appear**

Wait ~30s (AI pipeline runs), then:
```bash
curl -s http://100.83.112.20:3023/api/radar/cards | jq '.[0]'
```

Expected: a structured card with `whoIsInPain`, `pain`, `context`, `currentWorkaround`, `urgencySignal`.

- [ ] **Step 6: Open the feed in browser and verify UI**

Navigate to `http://kevin.sisihome.org:3023`. Confirm:
- Header shows `/// WORLD PROBLEM RADAR`
- Feed shows problem cards with Who/Pain/Context/Workaround/Why now fields
- Paste bar present
- Scan Now button works

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered in task |
|---|---|
| Mission: no ranking, no recommendations | Types stripped; no scoring in radar.ts; no tier labels in web.ts |
| Non-goals | No deliberation, no cost model, no daily pick anywhere |
| Data Sources: HN Show/Ask HN | Task 5: external-sources.ts |
| Data Sources: Reddit 4 subreddits | Task 5: external-sources.ts |
| Data Sources: manual paste | Task 7: web.ts POST /api/radar/paste |
| Schema: raw_signals | Task 4: problem-cards.ts |
| Schema: problem_cards | Task 4: problem-cards.ts |
| AI 6.1 Signal Extractor | Task 6: radar.ts extractSignal() |
| AI 6.2 Problem Structurer | Task 6: radar.ts structureCard() |
| AI 6.3 Idea Seeds | Task 6: radar.ts generateIdeaSeeds() |
| Scan: background every 4h | Task 8: index.ts setInterval |
| Scan: manual trigger | Task 7: web.ts POST /api/radar/scan |
| UI: feed view, no ranking | Task 7: web.ts renderPage() |
| UI: card layout (who/pain/context/workaround/why) | Task 7: web.ts renderCard() |
| Migration approach A: freeze tag | Task 1 |
| Migration: delete dead modules | Task 1 |
| Migration: wipe DB | Task 9 |
| Preserved: keys.ts, provider.ts | Imported in web.ts + radar.ts |
| Preserved: runtime-overrides.ts | Task 3: rewritten with radarScan schema |
