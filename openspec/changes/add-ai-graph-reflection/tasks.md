## 1. Types And Config

- [x] 1.1 Extend `IdeaRecord` in `src/types.ts` with optional `aiSource: 'user' | 'ai-reflection'` and optional `aiReflection: { generatedAt: string; model: string; evidence: string[]; promptVersion: 'v1' }`.
- [x] 1.2 Add `ReflectionRecord`, `SkippedReflectionRecord`, `ReflectionIdeaSeed`, `ReflectionNextExploration`, and `AiReflectionConfig` types in `src/types.ts`. Add `aiReflection?: AiReflectionConfig` to `AutopilotConfig`.
- [x] 1.3 Add `lastReflectionAt?: string` to `ObservationLoopState` in `src/types.ts`.
- [x] 1.4 Add `thinking.nextExplorationAi?: boolean` (server-side render hint only — not stored) to the response shape returned by `/api/graph/nodes/:id`; design note recorded in `design.md`.

## 2. Reflection Module

- [x] 2.1 Create `src/reflection.ts` exporting `reflect(input: ReflectionInput): Promise<ReflectionRecord | SkippedReflectionRecord>` and `computeReflectionSignature(graph, backlog): string` using the existing `stableHash6` helper from `idea-graph.ts` (extract to a shared util if needed).
- [x] 2.2 Implement input builder `buildReflectionPromptInput({ graph, backlog, ideas, focusedNodeId, dismissedTitles, maxNodes: 18, maxBacklog: 6, maxIdeas: 5 })` that returns the bounded JSON payload described in `design.md` decision 3.
- [x] 2.3 Wire the Gemini call through `@kevinsisi/ai-core` `GeminiClient` + `KeyPool` + `FileKeyStorageAdapter` (same pattern as `ai.ts`), with `maxOutputTokens` from `config.aiReflection?.maxOutputTokens ?? 700` and timeout from `config.ai?.timeoutMs ?? 25_000`.
- [x] 2.4 Implement `parseReflectionOutput(text, knownNodeIds)`: extract JSON, hard-cap `newIdeaSeeds` to 2 and `nextExplorationRewrites` to 1, drop seeds with empty evidence, drop rewrites whose nodeId is not in `knownNodeIds`.
- [x] 2.5 Wrap success path so `reflect` returns a `ReflectionRecord` with `generatedAt`, `model`, `graphSignature`, `newIdeaSeeds`, `nextExplorationRewrites`, optional `tokenUsage`.
- [x] 2.6 Wrap failure paths so `reflect` returns a `SkippedReflectionRecord` with the right `reason` (`disabled`, `offline`, `error`, `unchanged`, `pending-cap`) and `detail` when applicable.

## 3. AI Idea Minting

- [x] 3.1 In `src/ideas.ts` (or new helper in `reflection.ts`), add `createAiIdeaFromSeed(config, seed: ReflectionIdeaSeed, reflectionMeta): Promise<IdeaRecord>` that builds an `IdeaRecord` analogous to `createIdea` but bypasses `analyzeIdeaWithAiCore`. The seed's title and rawText become the record's; classification defaults to `'explore'` unless rawText hits `BLOCKED_TERMS`; `aiSource = 'ai-reflection'`; `aiReflection` block populated from the reflection record.
- [x] 3.2 The id MUST be unique per seed: derive `id = makeIdeaId(now)` followed by `-r${index}` (1-based) so two seeds in one reflection don't collide.
- [x] 3.3 Reuse `analyzeExistingProjects`, `createAgentHandoff`, and `createProjectHandoffPlan` so AI ideas get the same project relationships and handoff prompt user ideas get.
- [x] 3.4 Save under `data/ideas/` via the existing `saveIdea` path.

## 4. Pending Cap And Dismiss

- [x] 4.1 Add `countPendingAiIdeas(config): Promise<number>` in `src/ideas.ts` — counts `IdeaRecord`s with `aiSource === 'ai-reflection'` under `data/ideas/`.
- [x] 4.2 In `reflect`, after building the prompt and BEFORE calling the AI, include the current pending count in the prompt and pass `maxNewSeeds = Math.max(0, cap - pendingCount)` into the system instruction.
- [x] 4.3 After parsing AI output, truncate `newIdeaSeeds` to `maxNewSeeds` as a defensive cap.
- [x] 4.4 Add `dismissIdea(config, id): Promise<IdeaRecord>` in `src/ideas.ts`: refuses if file not found, refuses (throws specific error) if `aiSource !== 'ai-reflection'`, otherwise reads, augments with `dismissedAt`, writes to `data/ideas-dismissed/${id}.json`, deletes original.
- [x] 4.5 Add `listDismissedAiIdeaTitles(config, limit = 20)` so the reflection prompt can include recent dismissals.

## 5. Observation Loop Integration

- [x] 5.1 In `src/observation-loop.ts:executeRun`, after `getIdeaGraph(...)` and the existing state update, when `config.aiReflection?.enabled === true`, load `graph + backlog + listIdeas(40)`, compute reflection signature, and call `reflect(...)`.
- [x] 5.2 If `reflect` returns a non-skipped record with `newIdeaSeeds`, call `createAiIdeaFromSeed` for each seed (already capped). If `nextExplorationRewrites` non-empty, store them as-is in the reflection record (no graph mutation).
- [x] 5.3 Persist `data/reflection-state.json` with the full record. Update `state.lastReflectionAt` to `record.generatedAt`.
- [x] 5.4 Make sure exceptions from reflection do not propagate: wrap the whole reflection block in try/catch, persist a `SkippedReflectionRecord { reason: 'error', detail }` on catch, and continue the cycle's existing successful-finalisation path.
- [x] 5.5 Ensure scheduling still happens via the existing `finally` block regardless of reflection outcome.

## 6. API Surface

- [x] 6.1 Add `GET /api/reflection/state` in `src/web.ts` returning the latest `data/reflection-state.json` content, or `{ skipped: true, reason: 'never-run', pendingAiIdeaCount: 0 }` when the file does not exist.
- [x] 6.2 Add `POST /api/ideas/:id/dismiss` in `src/web.ts` behind `isTrustedSettingsRequest`. Calls `dismissIdea`; returns 200 with the dismissed record, 400 if not an AI idea, 404 if missing.
- [x] 6.3 In `/api/graph/nodes/:id`, after computing the node detail, merge the latest reflection record's `nextExplorationRewrites` if it targets this node id AND was generated within the last hour. Set `node.thinking.nextExploration` to the AI text and add `node.thinking.nextExplorationAi = true` (read-time field only; not persisted).

## 7. Cockpit UI Wiring

- [x] 7.1 Add a top-of-cockpit status line ("上次反思：HH:MM · pending AI 想法 N/cap" or "反思離線：{detail}") that loads `/api/reflection/state` on page load and re-polls when `lastReflectionAt` changes via the existing 1-minute poll.
- [x] 7.2 In `renderIdea` (and the corresponding IDEA brain-node label), display an "AI 生" pill when `idea.aiSource === 'ai-reflection'` and a "永久略過" button that POSTs to `/api/ideas/:id/dismiss` and removes the card inline on success.
- [x] 7.3 In the right-panel selected-node detail, when `node.thinking.nextExplorationAi === true`, show a small "AI 改寫" tag next to the "下一步" line.

## 8. Tests

- [x] 8.1 Add `src/reflection.test.ts`: signature stability (same inputs → same hash, ordering-independent); `parseReflectionOutput` truncates seeds to 2, rewrites to 1, drops empty-evidence seeds, drops unknown-nodeId rewrites; signature mismatch triggers a non-skip path (via mocked `GeminiClient.generateContent`).
- [x] 8.2 Add `src/ideas.test.ts` cases for `createAiIdeaFromSeed` (idempotent within one reflection via `-r${index}` suffix), `countPendingAiIdeas`, and `dismissIdea` (rejects user ideas, succeeds on AI ideas, moves file).
- [x] 8.3 Add `src/observation-loop.test.ts` (new file or extend existing) covering: reflection skipped when disabled; reflection skipped when graph unchanged; reflection error does not fail the cycle; `state.lastReflectionAt` advances on success.
- [x] 8.4 Add `src/web.test.ts` cases: `GET /api/reflection/state` returns `never-run` shape before any cycle; `POST /api/ideas/:id/dismiss` rejects unknown id with 404 and user ideas with 400; trusted-settings guard returns 403 from non-loopback.
- [x] 8.5 Make sure all existing tests still pass; update any assertions that compared the full `IdeaRecord` JSON shape to account for the new optional `aiSource`.

## 9. Documentation And Release

- [x] 9.1 Bump `src/version.ts`, `package.json`, `package-lock.json`, and `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.11.0`.
- [x] 9.2 Add a v0.11.0 entry to `README.md` and `AGENTS.md` describing AI reflection scope, pending cap, dismiss path, and the `aiReflection` config block.
- [x] 9.3 Add an `aiReflection` example block to `config/kevinhome.example.json` and `config/kevinhome.windows.example.json` if the latter exists, defaulting to `enabled: false` so first deploy is dark.
- [x] 9.4 Run `npm run build` and `npm test` and confirm 0 failures.

## 10. Verification And Deploy

- [x] 10.1 Rebuild the local Docker image and verify `/health` returns `0.11.0`, `/api/reflection/state` returns the never-run shape on first boot, and the cockpit shows the reflection status line ("反思離線：disabled" with `aiReflection.enabled = false`).
- [ ] 10.2 Flip `aiReflection.enabled = true` locally with a real Gemini key, observe at least one cycle, confirm `/api/reflection/state` returns a non-skipped record OR a clearly-explained skip, and confirm any AI idea card shows the AI 生 pill and a working dismiss action.
- [ ] 10.3 Commit, push, verify `deploy-dev` brings `https://kevin.sisihome.org/health` to `0.11.0`. The kevinhome config keeps `aiReflection.enabled = false` until Kevin manually flips it on the host.
