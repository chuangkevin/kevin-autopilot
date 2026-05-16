## 1. Product Alignment

- [x] 1.1 Update `README.md` north-star copy: Kevin Autopilot is a real-world workflow pain discovery agent, not an infra monitor or graph toy.
- [x] 1.2 Update `AGENTS.md` approved-version history after implementation with the new capability and read-only boundary.
- [x] 1.3 Add a short dashboard copy block that states the first question: "今天哪群人的哪個流程正在被爛工具、人工繞路、資訊混亂、平台限制拖累？"

## 2. Types And Persistence

- [x] 2.1 Add `ProblemSignal`, `ProblemBrief`, `DailyProblemPick`, and score/rationale supporting types in `src/types.ts`.
- [x] 2.2 Implement Autopilot-owned persistence for signals, briefs, and daily pick (`data/problem-signals/`, `data/problem-briefs/`, `data/daily-pick.json` or DB-backed equivalent).
- [x] 2.3 Add deterministic ids and deduplication keys so repeated sightings of the same problem update evidence instead of creating duplicate briefs.
- [x] 2.4 Add tests for persistence round-trip, missing optional fields, deduplication, and malformed stored data recovery.

## 3. Source Collection

- [x] 3.1 Create a small approved-source config for v1: Kevin-owned signals first, optional public web search second.
- [ ] 3.2 Implement source adapters with per-source timeout, rate limit, and provenance fields (`sourceType`, `sourceName`, `url`, `query`, `fetchedAt`).
- [ ] 3.3 Seed query patterns focused on pain/workaround language, not technical keywords.
- [x] 3.4 Ensure private/authenticated sources are impossible without explicit future config and approval.
- [ ] 3.5 Add tests for source timeout handling and provenance preservation.

## 4. Problem Extraction

- [x] 4.1 Implement classifier prompt/schema that extracts `people`, `workflow`, `pain`, `workaround`, `evidence`, and `missingEvidence`.
- [x] 4.2 Reject/downrank pure tech trends, generic startup ideas, and signals without source snippets.
- [x] 4.3 Require every accepted problem to name a people group and a workflow.
- [x] 4.4 Add tests using fixtures: tech-only trend rejected; Excel/LINE/screenshot workaround accepted; news converted only when affected workflow is explicit.

## 5. Opportunity Scoring

- [x] 5.1 Score evidence quality, severity, workaround clarity, Kevin fit, MVP feasibility, and validation clarity.
- [x] 5.2 Map Kevin fit against HomeProject precedent categories: car/listing ops, media/content production, bureaucratic workflow automation, PM-to-prototype, emotional/memory systems, photo/video-to-CAD, living-world systems.
- [x] 5.3 Generate `mvp`, `validationPlan`, and `killCriteria` for every accepted brief.
- [x] 5.4 Add tests for scoring and for "why not picked" explanations.

## 6. Daily Pick

- [x] 6.1 Implement `generateDailyProblemPick(date, briefs)` using `Asia/Taipei` date semantics.
- [x] 6.2 Persist daily pick and expose `GET /api/problem-discovery/daily`.
- [x] 6.3 Add `POST /api/problem-discovery/run` trusted-gated on-demand generation for debugging/iteration.
- [x] 6.4 Add tests for no-brief fallback, same-day stability, and next-day regeneration.

## 7. Dashboard Redesign

- [x] 7.1 Make the default mobile/desktop first screen `今日真實問題` instead of the graph.
- [x] 7.2 Render daily pick with: people, workflow, pain, workaround, evidence, existing solution gap, Kevin fit, MVP, validation plan, kill criteria.
- [x] 7.3 Add a copyable OpenCode prompt that asks for research/spec/prototype planning without creating repos or deploying.
- [x] 7.4 Move graph to a secondary `探索圖` or debug tab.
- [x] 7.5 Add empty-state copy for "今天還沒有足夠真實問題證據" rather than filling the page with speculative bubbles.
- [x] 7.6 Show a sanitized candidate problem pool so the first screen is not limited to one daily pick.

## 8. Observation Loop Integration

- [x] 8.1 Add problem discovery as an optional post-cycle stage after existing observation/reflection work.
- [x] 8.2 Ensure failures in source fetching or AI classification do not mark the whole observation cycle failed; persist diagnostic skip records.
- [x] 8.3 Expose last discovery run status through `GET /api/observation-loop` or a dedicated status endpoint.

## 9. Tests, Build, And Verification

- [x] 9.1 Run `npm run build` and record success.
- [x] 9.2 Run `npm test` and record success.
- [x] 9.3 Verify the dashboard loads and shows either a daily pick or a truthful empty state.
- [x] 9.4 Verify live deploy after version bump through GitHub Actions and `https://kevin.sisihome.org/health`.
- [x] 9.5 Add tests that reject internal repo/spec/test signals, preserve real PM/design prototype workflows, and verify the candidate pool/API shape.

## 10. Release / Archive

- [x] 10.1 Bump version after implementation scope is finalized.
- [x] 10.2 Commit and push implementation.
- [ ] 10.3 Archive this OpenSpec change only after live verification and dashboard review.
