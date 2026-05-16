## 1. Planning And Boundaries

- [ ] 1.1 Confirm this phase does not add external sources or crawling.
- [ ] 1.2 Keep all writes Autopilot-owned; no target repo mutation, deployment, spending, outreach, or destructive action.
- [ ] 1.3 Update `README.md` and `AGENTS.md` after implementation with the approved version and read-only boundary.

## 2. Types And Persistence

- [ ] 2.1 Add candidate evaluation and feedback types.
- [ ] 2.2 Persist feedback records in an Autopilot-owned store.
- [ ] 2.3 Add deterministic feedback ids or append-only records that deduplicate accidental double-clicks.
- [ ] 2.4 Add malformed feedback recovery tests.

## 3. Candidate Evaluation

- [ ] 3.1 Compute `worth_chasing`, `needs_evidence`, and `not_now` tiers for candidates.
- [ ] 3.2 Generate ranking rationale, strongest evidence summary, evidence gap, next validation step, and rejection reasons.
- [ ] 3.3 Apply feedback boosts/penalties without permanently burying candidates that gain new evidence.
- [ ] 3.4 Add tests for tiering, feedback impact, and new-evidence recovery.

## 4. Rejected Summary

- [ ] 4.1 Track rejected/downranked signal reasons during problem extraction.
- [ ] 4.2 Expose sanitized rejected summaries with reason counts and short examples.
- [ ] 4.3 Ensure internal engineering, tech-only, missing-people, missing-workflow, and duplicate cases are distinguishable.
- [ ] 4.4 Add tests that rejected summaries do not expose full evidence or raw private snippets.

## 5. API

- [ ] 5.1 Extend `GET /api/problem-discovery/daily` with sanitized candidate evaluations and rejected summaries.
- [ ] 5.2 Add trusted-gated `POST /api/problem-discovery/:briefId/feedback`.
- [ ] 5.3 Return updated evaluation after feedback writes.
- [ ] 5.4 Add API tests for public read shape, trusted write success, and untrusted write rejection.

## 6. Dashboard UX

- [ ] 6.1 Group candidate pool by `值得追`, `先補證據`, and collapsed `暫時不追` summary.
- [ ] 6.2 Add compact validation cards to candidate cards.
- [ ] 6.3 Add feedback buttons with clear copy: `有趣`, `無聊`, `不是問題`, `再找類似`.
- [ ] 6.4 Keep mobile first screen readable without opening the graph.
- [ ] 6.5 Add HTML tests for tier headings, feedback controls, validation cards, and rejected summary.

## 7. Verification And Release

- [ ] 7.1 Run `npm run build`.
- [ ] 7.2 Run `npm test`.
- [ ] 7.3 Run `git diff --check`.
- [ ] 7.4 Bump app/package/deploy expected version.
- [ ] 7.5 Commit and push implementation.
- [ ] 7.6 Track CI, image build, and Kevinhome deploy to success.
- [ ] 7.7 Verify live health version, candidate tier UI, public API safety, and trusted-gated feedback behavior.
