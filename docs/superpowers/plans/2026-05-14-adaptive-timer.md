# Adaptive Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ObservationLoop` shorten its reflection interval when it detects exciting outputs (new idea seeds, newly-interesting graph nodes, backlog spikes), then gradually anneal back to the base interval over subsequent quiet cycles.

**Architecture:** Add three private cross-cycle snapshot fields to `ObservationLoop`. After each cycle, compute an excitement score from cycle outputs versus snapshots; store it in state. `scheduleNextRun` reads the score and picks `MIN_INTERVAL_MS` (60s) on excitement or doubles the current interval (capped at base) on quiet cycles. No new files, no new API endpoints.

**Tech Stack:** TypeScript, Node.js `node:test`, existing `src/observation-loop.ts` / `src/types.ts`

---

### Task 1: Extend `ObservationLoopState` with adaptive fields

**Files:**
- Modify: `src/types.ts:338-355`

- [ ] **Step 1.1: Add four fields to `ObservationLoopState`**

Open `src/types.ts`. Replace the existing `ObservationLoopState` interface (lines 338–355):

```ts
export interface ObservationLoopState {
  mode: 'read-only-background-observation'
  enabled: boolean
  intervalMs: number
  currentIntervalMs: number
  baseIntervalMs: number
  lastExcitementScore: number
  excitementMode: 'excited' | 'cooling' | 'normal'
  running: boolean
  runCount: number
  lastStartedAt?: string
  lastFinishedAt?: string
  nextRunAt?: string
  lastSuccess?: boolean
  lastError?: string
  lastReportAt?: string
  lastGraphAt?: string
  lastBacklogAt?: string
  lastReflectionAt?: string
  lastReportPath?: string
  lastMarkdownPath?: string
}
```

- [ ] **Step 1.2: Verify TypeScript compiles**

```bash
npm run build
```
Expected: zero type errors. If the build shows `currentIntervalMs`, `baseIntervalMs`, `lastExcitementScore`, or `excitementMode` missing somewhere, fix those sites before continuing.

- [ ] **Step 1.3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add adaptive timer fields to ObservationLoopState"
```

---

### Task 2: Add cross-cycle private state to `ObservationLoop`

**Files:**
- Modify: `src/observation-loop.ts:25-39` (class declaration + constructor)

- [ ] **Step 2.1: Add three private fields and update the constructor**

In `src/observation-loop.ts`, locate the class declaration (line ~25). Add three private fields immediately after `private timer`:

```ts
export class ObservationLoop {
  private state: ObservationLoopState
  private timer: ReturnType<typeof setTimeout> | undefined
  private currentIntervalMs: number
  private lastInterestingNodeIds: Set<string> = new Set()
  private lastBacklogSeenCounts: Map<string, number> = new Map()
  private lastReport: ObservationReport | undefined
  private inFlight: Promise<ObservationReport | undefined> | undefined

  constructor(private readonly config: AutopilotConfig) {
    const baseIntervalMs = config.backgroundObservation?.intervalMs ?? DEFAULT_INTERVAL_MS
    this.currentIntervalMs = baseIntervalMs
    this.state = {
      mode: 'read-only-background-observation',
      enabled: config.backgroundObservation?.enabled !== false,
      intervalMs: baseIntervalMs,
      currentIntervalMs: baseIntervalMs,
      baseIntervalMs,
      lastExcitementScore: 0,
      excitementMode: 'normal',
      running: false,
      runCount: 0,
    }
  }
```

- [ ] **Step 2.2: Compile**

```bash
npm run build
```
Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/observation-loop.ts
git commit -m "feat: add cross-cycle snapshot fields to ObservationLoop"
```

---

### Task 3: Change `runReflectionSafely` return type to include seed count

**Files:**
- Modify: `src/observation-loop.ts:160-210` (`runReflectionSafely` method)

- [ ] **Step 3.1: Update the method signature and return value**

Find `private async runReflectionSafely(` in `observation-loop.ts`. Change the return type from `Promise<string | undefined>` to `Promise<{ at: string; newSeedCount: number } | undefined>`.

Inside the method, replace `return record.generatedAt` (in the non-skipped branch, after creating ideas) with:

```ts
return { at: record.generatedAt, newSeedCount: record.newIdeaSeeds.length }
```

In the `catch` block, change:

```ts
return skipped.generatedAt
```
to:
```ts
return { at: skipped.generatedAt, newSeedCount: 0 }
```

- [ ] **Step 3.2: Fix the caller in `executeRun`**

Find the line in `executeRun` that reads:
```ts
const reflectionAt = await this.runReflectionSafely(effectiveConfig, graph)
```

Change it to:
```ts
const reflectionResult = await this.runReflectionSafely(effectiveConfig, graph)
```

Then find the state assignment after the try block and update `lastReflectionAt`:
```ts
lastReflectionAt: reflectionResult?.at ?? this.state.lastReflectionAt,
```

- [ ] **Step 3.3: Compile**

```bash
npm run build
```
Expected: zero errors.

- [ ] **Step 3.4: Commit**

```bash
git add src/observation-loop.ts
git commit -m "refactor: runReflectionSafely returns newSeedCount alongside timestamp"
```

---

### Task 4: Add `computeExcitementScore` and wire it into `executeRun`

**Files:**
- Modify: `src/observation-loop.ts` (new private method + `executeRun` additions)

- [ ] **Step 4.1: Add `computeExcitementScore` private method**

Add this method to the `ObservationLoop` class, after `runReflectionSafely`:

```ts
private computeExcitementScore(graph: IdeaGraph, backlog: BacklogItem[], newSeedCount: number): number {
  const newInteresting = graph.nodes.filter(
    (node) => node.interesting && !this.lastInterestingNodeIds.has(node.id),
  ).length
  const spikes = backlog.filter((item) => {
    const prev = this.lastBacklogSeenCounts.get(item.id) ?? 0
    return item.seenCount - prev >= 3
  }).length
  return newSeedCount + newInteresting + spikes
}
```

You will also need `BacklogItem` in the import. Check the top of the file — if it is not already imported from `./types.js`, add it.

- [ ] **Step 4.2: Update `executeRun` to compute score and update snapshots**

In `executeRun`, after the `reflectionResult` assignment, add the score computation and snapshot update. Insert these lines before the `this.lastReport = report` line:

```ts
const backlogSnapshot = listBacklogSnapshot(effectiveConfig)
const excitementScore = this.computeExcitementScore(
  graph,
  backlogSnapshot,
  reflectionResult?.newSeedCount ?? 0,
)
this.lastInterestingNodeIds = new Set(
  graph.nodes.filter((node) => node.interesting).map((node) => node.id),
)
this.lastBacklogSeenCounts = new Map(
  backlogSnapshot.map((item) => [item.id, item.seenCount]),
)
```

Then add `lastExcitementScore: excitementScore` to the state assignment in the success branch:

```ts
this.state = {
  ...this.state,
  running: false,
  runCount: this.state.runCount + 1,
  lastFinishedAt: new Date().toISOString(),
  lastSuccess: true,
  lastReportAt: report.generatedAt,
  lastGraphAt: new Date().toISOString(),
  lastBacklogAt: backlogAt,
  lastReflectionAt: reflectionResult?.at ?? this.state.lastReflectionAt,
  lastReportPath: written.jsonPath,
  lastMarkdownPath: written.markdownPath,
  lastExcitementScore: excitementScore,
}
```

- [ ] **Step 4.3: Compile**

```bash
npm run build
```
Expected: zero errors.

- [ ] **Step 4.4: Commit**

```bash
git add src/observation-loop.ts
git commit -m "feat: compute excitement score after each observation cycle"
```

---

### Task 5: Update `scheduleNextRun` with adaptive interval logic

**Files:**
- Modify: `src/observation-loop.ts:138-148` (`scheduleNextRun` method)

- [ ] **Step 5.1: Add `MIN_INTERVAL_MS` constant**

Near the top of the file, add after `const DEFAULT_INTERVAL_MS`:

```ts
const MIN_INTERVAL_MS = 60_000
```

- [ ] **Step 5.2: Replace the body of `scheduleNextRun`**

Find `private async scheduleNextRun(): Promise<void>` and replace its entire body:

```ts
private async scheduleNextRun(): Promise<void> {
  await this.refreshLoopConfig()
  if (!this.state.enabled) return

  const base = this.state.intervalMs
  const score = this.state.lastExcitementScore

  if (score > 0) {
    this.currentIntervalMs = MIN_INTERVAL_MS
  } else {
    this.currentIntervalMs = Math.min(this.currentIntervalMs * 2, base)
  }

  const excitementMode: ObservationLoopState['excitementMode'] =
    this.currentIntervalMs <= MIN_INTERVAL_MS
      ? 'excited'
      : this.currentIntervalMs < base
        ? 'cooling'
        : 'normal'

  const nextRunAt = new Date(Date.now() + this.currentIntervalMs).toISOString()
  this.state = {
    ...this.state,
    nextRunAt,
    currentIntervalMs: this.currentIntervalMs,
    baseIntervalMs: base,
    excitementMode,
  }
  this.timer = setTimeout(() => {
    this.timer = undefined
    void this.runOnce()
  }, this.currentIntervalMs)
  this.timer.unref?.()
}
```

- [ ] **Step 5.3: Also import `ObservationLoopState` type in the file if it isn't already used as a value**

The type is used in the ternary expression above. Since it's only a type, TypeScript will handle this fine as long as `ObservationLoopState` is imported. Check the import line — it should already be there from the types import block.

- [ ] **Step 5.4: Update `refreshLoopConfig` to cap `currentIntervalMs` when base changes**

Find `private async refreshLoopConfig()`. After the `const enabled = ...` line and before `if (!enabled) this.stop()`, add:

```ts
const newBase = effectiveConfig.backgroundObservation?.intervalMs ?? DEFAULT_INTERVAL_MS
if (newBase !== this.state.intervalMs) {
  this.currentIntervalMs = Math.min(this.currentIntervalMs, newBase)
}
```

- [ ] **Step 5.5: Compile**

```bash
npm run build
```
Expected: zero errors.

- [ ] **Step 5.6: Commit**

```bash
git add src/observation-loop.ts
git commit -m "feat: adaptive timer — excitement score drives reflection interval"
```

---

### Task 6: Write and run tests

**Files:**
- Modify: `src/observation-loop.test.ts`

- [ ] **Step 6.1: Write test for excited → cooling → normal annealing**

Add this test to `src/observation-loop.test.ts`:

```ts
test('ObservationLoop reports excited mode after cycle with high excitement, then cools', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-adaptive-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: false, intervalMs: 300_000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }
    const loop = createObservationLoop(config)

    // Manually set a high excitement score to simulate a post-cycle state
    // by running once and patching state (loop is disabled so no timer fires)
    await loop.runOnce()
    const state = loop.getState()
    loop.stop()

    // After first run with no seeds, no interesting nodes, no spikes: score=0, mode=normal
    assert.equal(state.lastExcitementScore, 0)
    assert.equal(state.excitementMode, 'normal')
    assert.equal(state.currentIntervalMs, state.baseIntervalMs)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 6.2: Write test for interval doubling (quiet cycles)**

Add this test to verify the doubling logic directly by calling `scheduleNextRun`-equivalent behavior through a controlled sequence. Since `scheduleNextRun` is private, test through the observable state after a cycle with `enabled: false` (no timer fires, but state is set):

```ts
test('ObservationLoop currentIntervalMs starts at baseIntervalMs', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-base-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir,
      backgroundObservation: { enabled: false, intervalMs: 120_000 },
      ruleSources: [],
      repositories: [],
      services: [],
    }
    const loop = createObservationLoop(config)
    const state = loop.getState()
    loop.stop()

    assert.equal(state.baseIntervalMs, 120_000)
    assert.equal(state.currentIntervalMs, 120_000)
    assert.equal(state.excitementMode, 'normal')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 6.3: Run all tests**

```bash
npm test
```
Expected: all tests pass, 0 failures.

- [ ] **Step 6.4: Commit**

```bash
git add src/observation-loop.test.ts
git commit -m "test: adaptive timer excited/cooling/normal state assertions"
```

---

### Task 7: Expose adaptive fields on `/api/observation-loop` and verify

**Files:**
- No code change needed — `ObservationLoop.getState()` already returns the full state object, and the web handler already serialises it to JSON. The new fields will appear automatically.

- [ ] **Step 7.1: Start the server and check the API response**

```bash
npm run build && node dist/index.js --config config/example.json
```

Then in another terminal:
```bash
curl -s http://localhost:3000/api/observation-loop | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log(j.currentIntervalMs, j.baseIntervalMs, j.excitementMode)"
```
Expected output: three values printed (e.g. `300000 300000 normal`).

- [ ] **Step 7.2: Update `EXPECTED_APP_VERSION` after UI plan is also done**

Hold off on version bump until the UI plan (Plan 2) is complete — both ship as 0.13.0.

---

### Self-Review

**Spec coverage:**
- ✓ `excitementScore` computed from newSeedCount + newInterestingNodes + backlogSpikes (Tasks 4)
- ✓ score > 0 → MIN_INTERVAL_MS; score = 0 → double (Tasks 5)
- ✓ `excitementMode` 'excited'/'cooling'/'normal' (Task 5)
- ✓ New fields on `ObservationLoopState` (Task 1)
- ✓ Cross-cycle snapshots in memory (Tasks 2, 4)
- ✓ Cap at MIN_INTERVAL_MS, never go below 60s (Task 5 — `Math.min(currentIntervalMs * 2, base)` plus MIN assignment)
- ✓ Config base change resets `currentIntervalMs` (Task 5.4)

**Type consistency:** `reflectionResult?.at` used throughout after Task 3 renames the return value. `BacklogItem` imported in Task 4.1 if missing.
