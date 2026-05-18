# Problem Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 問題 tab with a full-screen swipeable card stack that pulls from HN, Reddit, and manual paste in addition to Kevin-owned signals.

**Architecture:** Add `src/external-sources.ts` with HN and Reddit fetchers; wire them into `getDailyProblemDiscovery` via an `externalSignals` option; add a trusted `POST /api/problem-signal/ingest` endpoint for instant manual paste; replace `renderProblemTab` with `renderProblemStack` which renders one card at a time with a tap-to-expand detail section and a bottom paste bar.

**Tech Stack:** Node.js built-in test runner (`node:test`), TypeScript, plain HTML/CSS/JS generated server-side in `src/web.ts`. No new npm dependencies — external API calls use the native `fetch` global.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Modify | Add `hacker-news`, `reddit`, `threads-tw` to `ProblemSignalSourceType`; add `primarySourceType?` to `ProblemBrief` |
| `src/external-sources.ts` | Create | `fetchHackerNewsSignals()`, `fetchRedditSignals()`, `fetchExternalSignals()` |
| `src/external-sources.test.ts` | Create | Unit tests for HN and Reddit fetchers |
| `src/problem-discovery.ts` | Modify | Accept `externalSignals` option in `getDailyProblemDiscovery`; set `primarySourceType` in `buildProblemBrief` |
| `src/web.ts` | Modify | New `renderProblemStack()` replacing `renderProblemTab()`; new CSS; new navigation + expand JS; `POST /api/problem-signal/ingest` endpoint |
| `src/web.test.ts` | Modify | Tests for ingest endpoint; update problem tab HTML assertions |
| `src/observation-loop.ts` | Modify | Call `fetchExternalSignals()` before `getDailyProblemDiscovery` in `runProblemDiscoverySafely` |
| `src/version.ts` | Modify | Bump to `0.19.0` |

---

## Task 1: Extend Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1.1: Update ProblemSignalSourceType**

In `src/types.ts`, line 161, change:

```typescript
export type ProblemSignalSourceType = 'web-search' | 'news' | 'forum' | 'review' | 'github-issue' | 'kevin-input' | 'homeproject'
```

to:

```typescript
export type ProblemSignalSourceType = 'web-search' | 'news' | 'forum' | 'review' | 'github-issue' | 'kevin-input' | 'homeproject' | 'hacker-news' | 'reddit' | 'threads-tw'
```

- [ ] **Step 1.2: Add primarySourceType to ProblemBrief**

In `src/types.ts`, find the `ProblemBrief` interface and add the optional field after `sourceSignalIds`:

```typescript
  sourceSignalIds: string[]
  primarySourceType?: ProblemSignalSourceType
```

- [ ] **Step 1.3: Build to check no type errors**

```
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 1.4: Commit**

```
git add src/types.ts
git commit -m "feat: add hacker-news, reddit, threads-tw sourceTypes"
```

---

## Task 2: Create HN Fetcher (TDD)

**Files:**
- Create: `src/external-sources.ts`
- Create: `src/external-sources.test.ts`

- [ ] **Step 2.1: Write failing test**

Create `src/external-sources.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchHackerNewsSignals } from './external-sources.js'

test('fetchHackerNewsSignals parses HN API response into ProblemSignals', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    hits: [
      {
        objectID: 'hn-42',
        title: 'Ask HN: How do you handle repetitive file renaming workflows?',
        story_text: 'I spend over three hours every week manually renaming and organizing exported files for clients. Every client has a different folder structure requirement and there is no tool that handles batch renaming with custom patterns. The current workaround is a fragile shell script that breaks whenever the export format changes.',
      },
      { objectID: 'hn-43', title: 'Short', story_text: 'too short' },
    ]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const signals = await fetchHackerNewsSignals({ timeout: 5000 })
    assert.ok(signals.length >= 1, 'expected at least one signal')
    const s = signals[0]
    assert.equal(s.sourceType, 'hacker-news')
    assert.ok(s.sourceName.startsWith('hacker-news:'), `sourceName should start with hacker-news: — got ${s.sourceName}`)
    assert.ok(s.url?.includes('news.ycombinator.com'), 'url should point to HN')
    assert.ok(s.snippet.length >= 80, 'snippet should be at least 80 chars')
    assert.ok(s.title.length > 0)
    assert.ok(typeof s.dedupKey === 'string' && s.dedupKey.length > 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchHackerNewsSignals returns empty array when fetch throws', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network error') }
  try {
    const signals = await fetchHackerNewsSignals({ timeout: 5000 })
    assert.deepEqual(signals, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchHackerNewsSignals returns empty array when API returns non-200', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 429 })
  try {
    const signals = await fetchHackerNewsSignals({ timeout: 5000 })
    assert.deepEqual(signals, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
```

- [ ] **Step 2.2: Run test to confirm it fails**

```
npm run build 2>&1 | head -5
```

Expected: build error — `external-sources.ts` not found.

- [ ] **Step 2.3: Create src/external-sources.ts with HN fetcher**

Create `src/external-sources.ts`:

```typescript
import { createProblemSignal } from './problem-discovery.js'
import type { ProblemSignal } from './types.js'

const HN_QUERIES = [
  'workflow broken manual hours',
  'tool missing automate annoying',
  'frustrating repetitive process workaround',
]
const HN_TAGS = ['ask_hn', 'show_hn']
const HN_BASE = 'https://hn.algolia.com/api/v1/search'

export async function fetchHackerNewsSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const timeout = options.timeout ?? 10_000
  const signals: ProblemSignal[] = []
  const fetchedAt = new Date().toISOString()
  for (const tag of HN_TAGS) {
    for (const query of HN_QUERIES) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeout)
        const res = await fetch(`${HN_BASE}?query=${encodeURIComponent(query)}&tags=${tag}&hitsPerPage=10`, { signal: ctrl.signal })
        clearTimeout(timer)
        if (!res.ok) continue
        const data = await res.json() as { hits?: unknown[] }
        for (const hit of data.hits ?? []) {
          const h = hit as Record<string, unknown>
          const text = [String(h.story_text ?? ''), String(h.comment_text ?? '')].filter(Boolean).join(' ').trim()
          if (text.length < 80) continue
          signals.push(createProblemSignal({
            sourceType: 'hacker-news',
            sourceName: `hacker-news:${String(h.objectID ?? 'unknown')}`,
            title: String(h.title ?? query).slice(0, 180),
            snippet: text.slice(0, 1200),
            fetchedAt,
            url: `https://news.ycombinator.com/item?id=${String(h.objectID ?? '')}`,
            query,
          }))
        }
      } catch { /* per-query failure: ignore and continue */ }
    }
  }
  return signals
}
```

- [ ] **Step 2.4: Build and run tests**

```
npm run build && npm test 2>&1 | grep -E "✓|✗|FAIL|PASS|external-sources"
```

Expected: HN fetcher tests pass.

- [ ] **Step 2.5: Commit**

```
git add src/external-sources.ts src/external-sources.test.ts
git commit -m "feat: add HN fetcher to external-sources"
```

---

## Task 3: Add Reddit Fetcher

**Files:**
- Modify: `src/external-sources.ts`
- Modify: `src/external-sources.test.ts`

- [ ] **Step 3.1: Write failing test**

Append to `src/external-sources.test.ts`:

```typescript
import { fetchRedditSignals, fetchExternalSignals } from './external-sources.js'

test('fetchRedditSignals parses Reddit JSON API response', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      children: [
        { data: { id: 'r1', title: 'How do I automate my client invoicing?', selftext: 'I am spending hours every week manually creating invoices for each client. There must be a better way but I cannot find any tool that handles my specific edge cases. Currently I export data from a spreadsheet and copy-paste values into a PDF template which takes forever.', permalink: '/r/freelance/comments/r1/how_do_i_automate/' } },
        { data: { id: 'r2', title: 'Short', selftext: 'too short' } },
      ]
    }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const signals = await fetchRedditSignals({ timeout: 5000 })
    assert.ok(signals.length >= 1, 'expected at least one signal')
    const s = signals[0]
    assert.equal(s.sourceType, 'reddit')
    assert.ok(s.sourceName.startsWith('reddit:'), `sourceName should start with reddit: — got ${s.sourceName}`)
    assert.ok(s.url?.includes('reddit.com'))
    assert.ok(s.snippet.length >= 80)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchRedditSignals returns empty array on network failure', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network error') }
  try {
    const signals = await fetchRedditSignals({ timeout: 5000 })
    assert.deepEqual(signals, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchExternalSignals combines HN and Reddit results', async () => {
  const originalFetch = globalThis.fetch
  let callCount = 0
  globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    callCount++
    const url = String(input)
    if (url.includes('hn.algolia.com')) {
      return new Response(JSON.stringify({ hits: [{ objectID: 'x1', title: 'Ask HN: broken workflow', story_text: 'I spend three hours daily doing repetitive manual work because the tools available do not support automation. The current workaround is error-prone scripting that breaks regularly and nobody wants to maintain.' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ data: { children: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const signals = await fetchExternalSignals({ timeout: 5000 })
    assert.ok(callCount > 0, 'fetch should have been called')
    const hnSignals = signals.filter((s) => s.sourceType === 'hacker-news')
    assert.ok(hnSignals.length >= 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
```

Also update the import at the top of the test file to include `fetchRedditSignals` and `fetchExternalSignals`.

- [ ] **Step 3.2: Implement Reddit fetcher + fetchExternalSignals in src/external-sources.ts**

Append to the end of `src/external-sources.ts`:

```typescript
const REDDIT_SUBREDDITS = ['smallbusiness', 'freelance', 'productivity', 'SideProject']
const REDDIT_AGENT = 'kevin-autopilot/1.0 (personal research tool)'

export async function fetchRedditSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const timeout = options.timeout ?? 10_000
  const signals: ProblemSignal[] = []
  const fetchedAt = new Date().toISOString()
  for (const sub of REDDIT_SUBREDDITS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      const res = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=25`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': REDDIT_AGENT },
      })
      clearTimeout(timer)
      if (!res.ok) continue
      const data = await res.json() as { data?: { children?: unknown[] } }
      for (const child of data.data?.children ?? []) {
        const post = (child as { data?: Record<string, unknown> }).data
        if (!post) continue
        const text = String(post.selftext ?? '').trim()
        if (text.length < 80) continue
        signals.push(createProblemSignal({
          sourceType: 'reddit',
          sourceName: `reddit:${sub}:${String(post.id ?? 'unknown')}`,
          title: String(post.title ?? '').slice(0, 180),
          snippet: text.slice(0, 1200),
          fetchedAt,
          url: `https://www.reddit.com${String(post.permalink ?? '')}`,
          query: sub,
        }))
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

- [ ] **Step 3.3: Build and run tests**

```
npm run build && npm test 2>&1 | grep -E "✓|✗|external-sources"
```

Expected: all external-sources tests pass.

- [ ] **Step 3.4: Commit**

```
git add src/external-sources.ts src/external-sources.test.ts
git commit -m "feat: add Reddit fetcher and fetchExternalSignals"
```

---

## Task 4: Wire External Signals into getDailyProblemDiscovery

**Files:**
- Modify: `src/problem-discovery.ts`

- [ ] **Step 4.1: Add externalSignals option to getDailyProblemDiscovery**

In `src/problem-discovery.ts`, line 67–68, change the function signature:

```typescript
export async function getDailyProblemDiscovery(
  config: AutopilotConfig,
  options: { force?: boolean; report?: ObservationReport; now?: Date; externalSignals?: ProblemSignal[] } = {},
): Promise<DailyProblemDiscovery> {
```

Then change line 73 (the `collectKevinOwnedSignals` call) to also incorporate external signals:

```typescript
  const kevinOwned = await collectKevinOwnedSignals(config, options.report, now)
  const allCollected = [...kevinOwned, ...(options.externalSignals ?? [])]
  await upsertProblemSignals(config, allCollected)
```

Remove the old line `const collected = await collectKevinOwnedSignals(config, options.report, now)` and `await upsertProblemSignals(config, collected)`.

- [ ] **Step 4.2: Set primarySourceType in buildProblemBrief**

In `src/problem-discovery.ts`, at the return object inside `buildProblemBrief` (line ~553), add `primarySourceType` as the last field before the closing brace:

```typescript
    sourceSignalIds,
    primarySourceType: signal.sourceType,
  }
```

- [ ] **Step 4.3: Add ProblemSignal to import in web.ts** (will be needed in Task 5)

Check that `src/web.ts` already imports from `problem-discovery.js` — it does at line 36. No change needed yet.

- [ ] **Step 4.4: Build and run tests**

```
npm run build && npm test 2>&1 | grep -E "✓|✗|FAIL"
```

Expected: all tests pass.

- [ ] **Step 4.5: Commit**

```
git add src/problem-discovery.ts
git commit -m "feat: accept externalSignals in getDailyProblemDiscovery"
```

---

## Task 5: Add POST /api/problem-signal/ingest Endpoint (TDD)

**Files:**
- Modify: `src/web.ts`
- Modify: `src/web.test.ts`

- [ ] **Step 5.1: Write failing test**

Append to `src/web.test.ts` (after the last existing test):

```typescript
test('POST /api/problem-signal/ingest creates a signal from trusted address', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-ingest-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`

    const res = await fetch(`${baseUrl}/api/problem-signal/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Freelance designers spend three hours every project manually renaming and organizing Figma export files. Each client has a different naming convention and there is no tool that handles custom batch renaming patterns. The current workaround is fragile shell scripts that break when the export format changes.'
      }),
    })
    assert.equal(res.status, 201)
    const json = await res.json() as { signal: string; briefCount: number }
    assert.equal(typeof json.signal, 'string')
    assert.ok(json.signal.startsWith('signal-'), `signal id should start with signal- — got ${json.signal}`)
    assert.equal(typeof json.briefCount, 'number')
  } finally {
    server.close()
    await rm(dataDir, { recursive: true })
  }
})

test('POST /api/problem-signal/ingest returns 400 for empty input', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-ingest2-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`

    const res = await fetch(`${baseUrl}/api/problem-signal/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '   ' }),
    })
    assert.equal(res.status, 400)
  } finally {
    server.close()
    await rm(dataDir, { recursive: true })
  }
})
```

- [ ] **Step 5.2: Run test to confirm it fails**

```
npm run build && npm test 2>&1 | grep -E "ingest|FAIL"
```

Expected: FAIL — endpoint does not exist yet.

- [ ] **Step 5.3: Add imports to web.ts**

In `src/web.ts`, find the import from `problem-discovery.js` (line 36). Add `upsertProblemSignals`, `createProblemSignal` to the import:

```typescript
import { createProblemBriefPrompt, createProblemSignal, getDailyProblemDiscovery, isProblemFeedbackAction, recordProblemFeedback, upsertProblemSignals, visibleProblemBriefs } from './problem-discovery.js'
```

Also add `ProblemSignalSourceType` to the type imports from `types.js`.

- [ ] **Step 5.4: Add ingest endpoint in web.ts**

In `src/web.ts`, locate the block for `POST /api/problem-discovery/:briefId/feedback` (around line 314). **After** that block but **before** the 404 fallthrough, add:

```typescript
  if (url.pathname === '/api/problem-signal/ingest' && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Problem signal ingest requires loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    let parsed: unknown
    try { parsed = JSON.parse(await readBody(request)) } catch { writeText(response, 'invalid JSON', 400); return }
    if (typeof parsed !== 'object' || !parsed || typeof (parsed as { input?: unknown }).input !== 'string') {
      writeText(response, 'body must be { input: string }', 400); return
    }
    const input = ((parsed as { input: string }).input).trim()
    if (!input) { writeText(response, 'input is empty', 400); return }

    let snippet = input
    let title = input.slice(0, 180)
    let resolvedUrl: string | undefined
    let sourceType: ProblemSignalSourceType = 'kevin-input'

    if (/^https?:\/\//.test(input)) {
      resolvedUrl = input
      if (/threads\.net/i.test(input)) sourceType = 'threads-tw'
      else if (/reddit\.com/i.test(input)) sourceType = 'reddit'
      else if (/news\.ycombinator\.com/i.test(input)) sourceType = 'hacker-news'
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 5000)
        const pageRes = await fetch(input, { signal: ctrl.signal, headers: { 'User-Agent': 'kevin-autopilot/1.0' } })
        clearTimeout(timer)
        if (pageRes.ok) {
          const html = await pageRes.text()
          snippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
          if (titleMatch?.[1]) title = titleMatch[1].trim().slice(0, 180)
        }
      } catch { /* use raw URL as snippet on fetch failure */ }
    }

    const signal = createProblemSignal({ sourceType, sourceName: `manual:${Date.now()}`, title, snippet, fetchedAt: new Date().toISOString(), url: resolvedUrl })
    await upsertProblemSignals(config, [signal])
    const discovery = await getDailyProblemDiscovery(config, { report, force: true })
    writeJson(response, { signal: signal.id, briefCount: discovery.briefs.length }, 201)
    return
  }
```

Note: `report` is already in scope in the request handler at that point. Confirm by checking the handler block where `report` is defined (around line 650 area where the main GET handler renders the page).

Actually, `report` is NOT in scope at the API handler level (it's only fetched for the GET render). For the ingest endpoint, pass `undefined` for report:

```typescript
    const discovery = await getDailyProblemDiscovery(config, { force: true })
```

- [ ] **Step 5.5: Build and run tests**

```
npm run build && npm test 2>&1 | grep -E "✓|✗|ingest"
```

Expected: both ingest tests pass.

- [ ] **Step 5.6: Commit**

```
git add src/web.ts src/web.test.ts
git commit -m "feat: add POST /api/problem-signal/ingest endpoint"
```

---

## Task 6: Replace renderProblemTab with renderProblemStack

**Files:**
- Modify: `src/web.ts`
- Modify: `src/web.test.ts`

- [ ] **Step 6.1: Write failing HTML test**

Append to `src/web.test.ts`:

```typescript
test('problem tab renders swipeable card stack', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-ps-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`

    const res = await fetch(baseUrl)
    const html = await res.text()

    assert.ok(html.includes('data-ps-stack'), 'problem stack container should be present')
    assert.ok(html.includes('ps-paste-input'), 'paste input should be present')
    assert.ok(html.includes('/api/problem-signal/ingest'), 'ingest endpoint reference should be present')
  } finally {
    server.close()
    await rm(dataDir, { recursive: true })
  }
})
```

- [ ] **Step 6.2: Run to confirm it fails**

```
npm run build && npm test 2>&1 | grep -E "swipeable|FAIL"
```

Expected: FAIL — `data-ps-stack` not found.

- [ ] **Step 6.3: Add CSS for problem card stack**

In `src/web.ts`, find the existing `.problem-hero { ... }` CSS block (around line 998). **After** the last `.problem-*` CSS rule and **before** the next unrelated rule, add:

```css
.problem-stack { width: 100%; padding-bottom: 8px; }
.ps-nav { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 8px; }
.ps-dots { display: flex; gap: 5px; align-items: center; }
.ps-dot { width: 8px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.15); transition: all 180ms; }
.ps-dot.active { width: 22px; }
.ps-dot.active.tier-pick { background: #4ade80; }
.ps-dot.active.tier-worth { background: #818cf8; }
.ps-dot.active.tier-evidence { background: #fbbf24; }
.ps-dot.active.tier-notnow { background: #64748b; }
.ps-nav-btn { background: transparent; border: 1px solid rgba(148,163,184,.2); border-radius: 999px; color: #64748b; padding: 4px 12px; font-size: 14px; cursor: pointer; }
.ps-nav-btn:disabled { opacity: .3; cursor: default; }
.ps-card-wrap { position: relative; }
.ps-card { border-radius: 22px; padding: 20px; display: flex; flex-direction: column; gap: 12px; transition: transform 220ms ease, opacity 220ms ease; }
.ps-card[hidden] { display: none; }
.ps-card.tier-pick { background: linear-gradient(160deg, rgba(20,83,45,.85), rgba(15,23,42,.95)); border: 1px solid rgba(34,197,94,.5); }
.ps-card.tier-worth { background: linear-gradient(160deg, rgba(30,58,138,.8), rgba(15,23,42,.95)); border: 1px solid rgba(99,102,241,.5); }
.ps-card.tier-evidence { background: linear-gradient(160deg, rgba(120,53,15,.7), rgba(15,23,42,.9)); border: 1px solid rgba(245,158,11,.4); }
.ps-card.tier-notnow { background: rgba(15,23,42,.7); border: 1px solid rgba(148,163,184,.18); opacity: .72; }
.ps-badges { display: flex; gap: 7px; flex-wrap: wrap; }
.ps-badge { font-size: 10px; border: 1px solid; border-radius: 999px; padding: 3px 9px; letter-spacing: .06em; text-transform: uppercase; }
.ps-badge.tier-pick { color: #86efac; border-color: rgba(34,197,94,.4); }
.ps-badge.tier-worth { color: #a5b4fc; border-color: rgba(99,102,241,.4); }
.ps-badge.tier-evidence { color: #fcd34d; border-color: rgba(245,158,11,.4); }
.ps-badge.tier-notnow { color: #94a3b8; border-color: rgba(148,163,184,.25); }
.ps-badge.src-hn { color: #fdba74; border-color: rgba(249,115,22,.3); }
.ps-badge.src-reddit { color: #fca5a5; border-color: rgba(239,68,68,.3); }
.ps-badge.src-threads { color: #d8b4fe; border-color: rgba(168,85,247,.3); }
.ps-badge.src-manual { color: #86efac; border-color: rgba(34,197,94,.25); }
.ps-title { margin: 0; font-size: clamp(18px, 5vw, 26px); font-weight: 700; color: #f0fdf4; line-height: 1.25; }
.ps-lede { margin: 0; font-size: 14px; color: #bbf7d0; line-height: 1.45; }
.ps-score { font-size: 12px; color: #64748b; }
.ps-expand-hint { text-align: center; font-size: 11px; color: #475569; padding: 4px 0; cursor: pointer; user-select: none; letter-spacing: .04em; }
.ps-expand { overflow: hidden; max-height: 0; transition: max-height 360ms ease; }
.ps-card.expanded .ps-expand { max-height: 900px; }
.ps-card.expanded .ps-expand-hint { display: none; }
.ps-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; margin-top: 4px; }
.ps-detail-box { background: rgba(2,6,23,.6); border: 1px solid rgba(148,163,184,.12); border-radius: 12px; padding: 10px; }
.ps-detail-box strong { display: block; color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; font-weight: 400; }
.ps-detail-box.full { grid-column: 1 / -1; }
.ps-evidence { margin-top: 8px; background: rgba(2,6,23,.5); border: 1px solid rgba(148,163,184,.1); border-radius: 12px; padding: 10px; }
.ps-evidence-label { font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
.ps-evidence-quote { font-size: 12px; color: #94a3b8; line-height: 1.5; border-left: 2px solid rgba(99,102,241,.35); padding-left: 8px; margin-bottom: 6px; }
.ps-evidence-source { font-size: 11px; color: #475569; }
.ps-feedback { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.ps-feedback button { padding: 9px; border-radius: 13px; font-size: 13px; cursor: pointer; }
.ps-paste { display: flex; gap: 8px; margin-top: 8px; }
.ps-paste-input { flex: 1; background: rgba(15,23,42,.7); border: 1px solid rgba(148,163,184,.2); border-radius: 12px; padding: 10px 14px; color: #e2e8f0; font-size: 14px; min-width: 0; }
.ps-paste-input::placeholder { color: #334155; }
.ps-paste-btn { background: rgba(30,27,75,.4); border: 1px solid rgba(99,102,241,.4); border-radius: 12px; color: #a5b4fc; font-size: 13px; padding: 10px 16px; cursor: pointer; white-space: nowrap; }
.ps-empty { padding: 28px 0; text-align: center; }
```

- [ ] **Step 6.4: Add renderProblemStack function**

In `src/web.ts`, find `function renderProblemTab` (line 2030) and **replace the entire function** (lines 2030–2090) with the following new functions:

```typescript
function renderProblemStack(discovery: DailyProblemDiscovery): string {
  const evaluations = new Map(discovery.evaluations.map((e) => [e.briefId, e]))
  const visible = visibleProblemCandidates(discovery)
    .sort((a, b) => (evaluations.get(a.id)?.rank ?? 999) - (evaluations.get(b.id)?.rank ?? 999))

  const cards: Array<{ brief: typeof visible[number]; evaluation: ReturnType<typeof evaluations.get>; isPick: boolean }> = []
  if (discovery.brief && discovery.pick.status === 'picked') {
    cards.push({ brief: discovery.brief, evaluation: evaluations.get(discovery.brief.id), isPick: true })
  }
  for (const brief of visible) {
    if (discovery.brief && brief.id === discovery.brief.id) continue
    cards.push({ brief, evaluation: evaluations.get(brief.id), isPick: false })
  }

  if (cards.length === 0) {
    return `<section class="cp-card problem-empty problem-stack" data-ps-stack>
  <div class="sys-label">/// 今日真實問題</div>
  <div class="ps-empty">
    <h2 class="problem-title" style="font-size:22px">還沒有足夠的真實問題證據</h2>
    <p class="muted">今天哪群人的哪個流程正在被爛工具、人工繞路、資訊混亂、平台限制拖累？</p>
    <form onsubmit="event.preventDefault();fetch('/api/problem-discovery/run',{method:'POST'}).then(function(){location.reload();});">
      <button type="submit" class="secondary">重新整理 signals</button>
    </form>
  </div>
  ${renderPsRejectedSummary(discovery.rejectedSummary)}
  ${renderPsPasteBar()}
</section>`
  }

  const dotHtml = cards.map((c, i) => {
    const tierClass = c.isPick ? 'tier-pick' : tierCssClass(c.evaluation?.tier)
    return `<div class="ps-dot${i === 0 ? ` active ${tierClass}` : ''}" data-ps-dot="${i}"></div>`
  }).join('')

  const cardHtml = cards.map((c, i) => renderPsCard(c.brief, c.evaluation, c.isPick, i)).join('\n')

  return `<section class="problem-stack" data-ps-stack>
  <div class="ps-nav">
    <button class="ps-nav-btn" data-ps-prev disabled>← 上一張</button>
    <div class="ps-dots">${dotHtml}</div>
    <button class="ps-nav-btn" data-ps-next ${cards.length <= 1 ? 'disabled' : ''}>下一張 →</button>
  </div>
  <div class="ps-card-wrap">
    ${cardHtml}
  </div>
  ${renderPsRejectedSummary(discovery.rejectedSummary)}
  ${renderPsPasteBar()}
</section>
<script>
(function() {
  var stack = document.querySelector('[data-ps-stack]');
  if (!stack) return;
  var cards = stack.querySelectorAll('[data-ps-card]');
  var dots = stack.querySelectorAll('[data-ps-dot]');
  var prevBtn = stack.querySelector('[data-ps-prev]');
  var nextBtn = stack.querySelector('[data-ps-next]');
  var total = cards.length;
  var current = 0;
  var startX = 0;

  function showCard(index) {
    current = Math.max(0, Math.min(total - 1, index));
    cards.forEach(function(card, i) { card.hidden = i !== current; });
    dots.forEach(function(dot, i) {
      var tierClass = card.getAttribute('data-ps-tier') || '';
      dot.className = 'ps-dot' + (i === current ? ' active ' + (cards[i] ? (cards[i].getAttribute('data-ps-tier') || '') : '') : '');
    });
    if (prevBtn) prevBtn.disabled = current === 0;
    if (nextBtn) nextBtn.disabled = current === total - 1;
  }

  if (prevBtn) prevBtn.addEventListener('click', function() { showCard(current - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function() { showCard(current + 1); });

  stack.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; }, { passive: true });
  stack.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 44) showCard(dx < 0 ? current + 1 : current - 1);
  }, { passive: true });

  stack.addEventListener('click', function(e) {
    var trigger = e.target.closest('[data-ps-expand-trigger]');
    if (!trigger) return;
    if (e.target.closest('[data-ps-no-expand]')) return;
    trigger.classList.toggle('expanded');
  });

  showCard(0);
})();
</script>`
}

function renderPsCard(brief: DailyProblemDiscovery['briefs'][number], evaluation: ProblemCandidateEvaluation | undefined, isPick: boolean, index: number): string {
  const tier = evaluation?.tier
  const tierClass = isPick ? 'tier-pick' : tierCssClass(tier)
  const tierLabel = isPick ? '★ 今日精選' : (tier === 'worth_chasing' ? '值得追' : tier === 'not_now' ? '暫時不追' : '先補證據')
  const sourceClass = sourceCssClass(brief.primarySourceType)
  const sourceLabel = sourceDisplayLabel(brief.primarySourceType)

  const detailHtml = `<div class="ps-expand">
    <div class="ps-detail-grid">
      <div class="ps-detail-box"><strong>誰痛</strong>${escapeHtml(brief.people)}</div>
      <div class="ps-detail-box"><strong>痛在哪</strong>${escapeHtml(brief.pain)}</div>
      <div class="ps-detail-box"><strong>現在怎麼撐</strong>${escapeHtml(brief.workaround)}</div>
      <div class="ps-detail-box"><strong>一週 MVP</strong>${escapeHtml(brief.mvp)}</div>
      <div class="ps-detail-box full"><strong>驗證方式</strong>${escapeHtml(brief.validationPlan)}</div>
    </div>
    ${brief.evidence.length > 0 ? `<div class="ps-evidence">
      <div class="ps-evidence-label">證據片段</div>
      ${brief.evidence.slice(0, 3).map((entry) => `<div class="ps-evidence-quote">${escapeHtml(entry.quote.slice(0, 200))}<div class="ps-evidence-source">${escapeHtml(entry.sourceName)}${entry.url ? ` · <a href="${escapeHtmlAttr(entry.url)}" target="_blank" rel="noopener">連結</a>` : ''}</div></div>`).join('')}
    </div>` : ''}
    ${evaluation?.rankingRationale ? `<div class="ps-detail-box full" style="margin-top:6px"><strong>${isPick ? '為何今天選它' : '排序理由'}</strong>${escapeHtml(evaluation.rankingRationale)}</div>` : ''}
  </div>`

  return `<div class="ps-card ${tierClass}" data-ps-card="${index}" data-ps-tier="${tierClass}" data-ps-expand-trigger>
  <div class="ps-badges">
    <span class="ps-badge ${tierClass}">${escapeHtml(tierLabel)}</span>
    ${sourceLabel ? `<span class="ps-badge ${sourceClass}">${escapeHtml(sourceLabel)}</span>` : ''}
  </div>
  <h2 class="ps-title">${escapeHtml(brief.title)}</h2>
  <p class="ps-lede">${escapeHtml(brief.people)}正在處理「${escapeHtml(brief.workflow)}」被拖慢。</p>
  <div class="ps-score">${brief.score}/100 · ${brief.evidence.length} evidence · ${escapeHtml(brief.confidence)}</div>
  <div class="ps-expand-hint" data-ps-no-expand>↑ 點卡片看詳情</div>
  ${detailHtml}
  <div class="ps-feedback" data-ps-no-expand>
    <button type="button" onclick="problemFeedback('${escapeHtmlAttr(brief.id)}','interesting',this)" style="border:1px solid rgba(74,222,128,.3);background:rgba(20,83,45,.2);color:#86efac">有趣 ★ ${evaluation?.feedbackSummary.interesting ?? 0}</button>
    <button type="button" onclick="problemFeedback('${escapeHtmlAttr(brief.id)}','boring',this)" style="border:1px solid rgba(248,113,113,.3);background:rgba(127,29,29,.18);color:#fca5a5">無聊 ${evaluation?.feedbackSummary.boring ?? 0}</button>
    <button type="button" onclick="problemFeedback('${escapeHtmlAttr(brief.id)}','not-a-problem',this)" style="border:1px solid rgba(148,163,184,.2);background:transparent;color:#94a3b8">不是問題 ${evaluation?.feedbackSummary.notAProblem ?? 0}</button>
    <button type="button" onclick="problemFeedback('${escapeHtmlAttr(brief.id)}','find-similar',this)" style="border:1px solid rgba(148,163,184,.2);background:transparent;color:#94a3b8">再找類似 ${evaluation?.feedbackSummary.findSimilar ?? 0}</button>
  </div>
</div>`
}

function renderPsPasteBar(): string {
  return `<div class="ps-paste">
  <input class="ps-paste-input" id="ps-paste-input" placeholder="貼入 URL 或文字 (Threads / HN / Reddit 都可以)..." autocomplete="off">
  <button class="ps-paste-btn" onclick="psIngest()">送出</button>
</div>
<script>
function psIngest() {
  var input = document.getElementById('ps-paste-input');
  var btn = document.querySelector('.ps-paste-btn');
  if (!input || !btn) return;
  var val = input.value.trim();
  if (!val) return;
  btn.disabled = true; btn.textContent = '處理中…';
  fetch('/api/problem-signal/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: val })
  }).then(function(r) {
    if (r.ok) { input.value = ''; btn.textContent = '✓ 已加入'; setTimeout(function() { location.reload(); }, 800); }
    else { r.text().then(function(t) { btn.textContent = '失敗: ' + t.slice(0, 40); btn.disabled = false; }); }
  }).catch(function(e) { btn.textContent = '失敗'; btn.disabled = false; });
}
</script>`
}

function renderPsRejectedSummary(rejectedSummary: RejectedProblemSummary[]): string {
  if (rejectedSummary.length === 0) return ''
  const total = rejectedSummary.reduce((s, item) => s + item.count, 0)
  return `<details style="margin-top:8px">
  <summary style="font-size:12px;color:#475569;cursor:pointer">已排除訊號 ${total} 筆 ▸</summary>
  <div class="problem-grid" style="margin-top:8px">
    ${rejectedSummary.map((item) => `<div class="problem-box"><strong>${escapeHtml(rejectedReasonLabel(item.reason))} · ${item.count}</strong>${item.examples.map((ex) => escapeHtml(`${ex.sourceType}: ${ex.title}`)).join('<br>')}</div>`).join('')}
  </div>
</details>`
}

function tierCssClass(tier: ProblemCandidateEvaluation['tier'] | undefined): string {
  if (tier === 'worth_chasing') return 'tier-worth'
  if (tier === 'not_now') return 'tier-notnow'
  return 'tier-evidence'
}

function sourceCssClass(sourceType: import('./types.js').ProblemSignalSourceType | undefined): string {
  if (sourceType === 'hacker-news') return 'src-hn'
  if (sourceType === 'reddit') return 'src-reddit'
  if (sourceType === 'threads-tw') return 'src-threads'
  if (sourceType === 'kevin-input') return 'src-manual'
  return ''
}

function sourceDisplayLabel(sourceType: import('./types.js').ProblemSignalSourceType | undefined): string {
  if (sourceType === 'hacker-news') return 'HN'
  if (sourceType === 'reddit') return 'Reddit'
  if (sourceType === 'threads-tw') return 'Threads'
  if (sourceType === 'kevin-input') return '手動'
  return ''
}
```

- [ ] **Step 6.5: Replace renderProblemTab calls**

In `src/web.ts`, find the two call sites:
- Line 1309: `${renderProblemTab(dailyProblem)}` → `${renderProblemStack(dailyProblem)}`
- Line 1318: `${renderProblemTab(dailyProblem)}` → `${renderProblemStack(dailyProblem)}`

Also delete the old `renderProblemTab`, `renderProblemCandidatePool`, and `renderProblemCandidateCard` functions (lines ~2030–2177) since they are fully replaced by the new functions above.

Keep `renderRejectedSummary` if it is used elsewhere; otherwise delete it too. Check: `grep -n "renderRejectedSummary\|renderProblemCandidatePool\|renderProblemCandidateCard\|renderProblemTab" src/web.ts` — if no calls remain, delete all.

- [ ] **Step 6.6: Build and run tests**

```
npm run build && npm test 2>&1 | grep -E "✓|✗|FAIL"
```

Expected: all tests pass including the new `problem tab renders swipeable card stack` test.

- [ ] **Step 6.7: Commit**

```
git add src/web.ts src/web.test.ts
git commit -m "feat: replace problem tab with swipeable card stack"
```

---

## Task 7: Wire External Sources to Observation Loop

**Files:**
- Modify: `src/observation-loop.ts`

- [ ] **Step 7.1: Add import**

In `src/observation-loop.ts`, find the existing import of `getDailyProblemDiscovery` (line 14):

```typescript
import { getDailyProblemDiscovery } from './problem-discovery.js'
```

Change to:

```typescript
import { getDailyProblemDiscovery } from './problem-discovery.js'
import { fetchExternalSignals } from './external-sources.js'
```

- [ ] **Step 7.2: Update runProblemDiscoverySafely**

In `src/observation-loop.ts`, find `runProblemDiscoverySafely` (line 292). Replace the function body:

```typescript
  private async runProblemDiscoverySafely(config: AutopilotConfig, report: ObservationReport): Promise<{ at: string; briefCount: number; error?: string } | undefined> {
    try {
      const externalSignals = await fetchExternalSignals({ timeout: 10_000 }).catch(() => [])
      const discovery = await getDailyProblemDiscovery(config, { report, externalSignals })
      return { at: discovery.generatedAt, briefCount: discovery.briefs.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('observation-loop: problem discovery failed:', message)
      return { at: new Date().toISOString(), briefCount: 0, error: message }
    }
  }
```

- [ ] **Step 7.3: Build and run all tests**

```
npm run build && npm test 2>&1 | grep -E "✓|✗|FAIL|error"
```

Expected: all tests pass. External source fetch failures are caught and do not break the loop.

- [ ] **Step 7.4: Commit**

```
git add src/observation-loop.ts
git commit -m "feat: fetch external signals in observation loop cycle"
```

---

## Task 8: Version Bump and Verification

**Files:**
- Modify: `src/version.ts`
- Modify: `README.md` (update version reference)
- Modify: `AGENTS.md` (update version reference)
- Modify: `.github/workflows/deploy-dev.yml` (update expected version)

- [ ] **Step 8.1: Bump version**

In `src/version.ts`:

```typescript
export const APP_VERSION = '0.19.0'
```

- [ ] **Step 8.2: Update README and AGENTS.md**

```
grep -n "0\.18\." README.md AGENTS.md
```

Replace all `0.18.x` version references with `0.19.0`.

- [ ] **Step 8.3: Update deploy expected version**

```
grep -n "0\.18\." .github/workflows/deploy-dev.yml
```

Replace the expected version with `0.19.0`.

- [ ] **Step 8.4: Final build and full test run**

```
npm run build && npm test
```

Expected: all tests pass, no errors.

- [ ] **Step 8.5: Check no unused dead code**

```
grep -n "renderProblemTab\|renderProblemCandidatePool\|renderProblemCandidateCard" src/web.ts
```

Expected: no results (these functions were deleted in Task 6).

- [ ] **Step 8.6: Commit and push**

```
git add src/version.ts README.md AGENTS.md .github/workflows/deploy-dev.yml package.json package-lock.json
git commit -m "feat: problem tab swipeable cards with HN/Reddit/ingest — v0.19.0"
git push
```

- [ ] **Step 8.7: Monitor CI and verify live health version**

After push, watch GitHub Actions. Once deploy completes:

```
curl -s https://kevin.sisihome.org/api/health | grep version
```

Expected: `"version":"0.19.0"`.

Also verify on mobile browser:
- 問題 tab shows card stack with dot indicator
- Left/right buttons navigate between cards
- Tapping card body expands the detail section
- Paste bar is visible at the bottom
- Pasting text and submitting adds a new card
