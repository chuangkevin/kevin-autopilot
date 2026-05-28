## Why

v0.18.x made Kevin Autopilot problem-first and added a visible candidate pool. The next gap is judgment quality: Kevin can see more than one candidate, but the UI still does not explain which candidates are worth chasing, which are evidence-thin, which were rejected as internal noise, or how Kevin's feedback should shape future picks.

Kevin's preference is to start from a real person's repeated operational pain, then validate with the smallest runnable artifact. The candidate pool should therefore behave like a decision surface, not a passive list.

## What Changes

- Add candidate evaluation metadata for every `ProblemBrief`: quality tier, ranking rationale, evidence gaps, validation next step, and rejection/downrank reasons.
- Add trusted-gated feedback actions so Kevin can mark candidates as `interesting`, `boring`, `not-a-problem`, or `find-similar` without mutating target projects.
- Add a rejected/downranked summary so the dashboard can say what was filtered out and why, without exposing full private evidence on the public endpoint.
- Update the problem dashboard so the first screen shows:
  - daily pick;
  - candidate pool grouped by quality;
  - per-candidate validation card;
  - feedback buttons;
  - rejected summary.
- Keep external source expansion out of this change. This phase improves decision quality using existing Kevin-owned signals first.

## Scope

### In Scope

- Autopilot-owned feedback persistence.
- Deterministic candidate evaluation before any AI assistance is considered.
- Safe API shapes for public reads and trusted-gated writes.
- Tests for ranking, feedback persistence, rejected summaries, and dashboard rendering.
- Version bump and live verification after implementation.

### Out of Scope

- Broad public crawling.
- Private/authenticated/paid source ingestion.
- Automatic repo creation, deployment, outreach, spending, target-project mutation, or destructive actions.
- Replacing the daily pick model; the daily pick remains the first card.

## Impact

- **Expected modified files:** `src/problem-discovery.ts`, `src/types.ts`, `src/web.ts`, tests, `README.md`, `AGENTS.md`, version/deploy metadata.
- **Expected persisted data:** Autopilot-owned feedback records under `data/problem-feedback/` or an equivalent Autopilot-owned store.
- **API:** likely add trusted-gated `POST /api/problem-discovery/:briefId/feedback`; extend `GET /api/problem-discovery/daily` with sanitized evaluation summaries and rejected counts.
- **Safety:** feedback only changes Autopilot-owned ranking metadata. It must not mutate target repos or approve implementation work.
