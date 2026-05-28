# Superseded by World Problem Radar v1.0.0

On 2026-05-26 the Kevin Autopilot product was torn down and rebuilt as **World Problem Radar v1.0.0** (commits `ec2983b` → `a69d7ff`). The rebuild was intentionally outside the OpenSpec workflow — it went through `docs/goal.md` and the implementation-plan note instead.

That rebuild **deleted** the autopilot scoring/ranking pipeline, the brain tab, the per-card deliberation, the persona-injection layer, the patrol chat, and the problem-candidate evaluation flow. The capabilities those changes added no longer exist in the running code.

The six changes archived alongside this note were the final pre-rebuild autopilot wave. They were partially implemented and shipped between v0.15.0 and v0.20.0, then removed wholesale by the rebuild. They are kept here for historical reference; their delta specs were **not** applied to `openspec/specs/` because the features they described no longer exist.

## Superseded changes (moved here on 2026-05-28)

- `2026-05-19-add-brain-tab-redesign` — Brain Tab UI rework. Brain tab removed.
- `2026-05-19-add-force-think` — On-demand "force think" deliberation pass. Deliberation engine removed.
- `2026-05-19-add-persona-injection` — Per-card persona prompt mixing. Personas removed.
- `2026-05-19-add-problem-candidate-evaluation` — pick/worth/evidence/notnow scoring tiers. Scoring removed (radar is strictly no-ranking).
- `2026-05-19-add-real-world-problem-discovery` — The autopilot-era predecessor of the radar, but with scoring/ranking/daily-pick semantics. Replaced by `world-problem-radar` capability (no ranking, no daily pick).
- `2026-05-19-proactive-patrol-chat` — Patrol chat push notifications. Patrol chat removed.

## Authoritative current spec

See `openspec/specs/world-problem-radar/spec.md` for the v1.0.0 contract. The `runtime-overrides` capability survives the rebuild (with the whitelist trimmed to `radarScan.*`).
