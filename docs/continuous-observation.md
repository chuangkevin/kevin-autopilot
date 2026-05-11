# Continuous Observation Plan

## Expectation

Kevin expects Autopilot to continuously watch different projects, notice bugs or
weak signals, and proactively plan useful adjustments without waiting for a
manual idea submission.

The system should behave like an always-on observer:

1. Look across configured projects.
2. Detect possible bugs, regressions, stale behavior, and broken checks.
3. Notice places that can be simplified, hardened, documented, tested, or turned
   into a better workflow.
4. Keep a living backlog of things worth doing.
5. Decide whether each item is safe to auto-prepare, needs Kevin approval, or
   should only be observed.

## Observation Sources

Start with read-only, low-risk signals:

1. Git dirty status and recent commits.
2. CI / GitHub Actions status.
3. Existing test and build commands.
4. TODO/FIXME markers.
5. Docs that mention behavior, ports, deployment, or usage.
6. Health endpoints explicitly allowed in config.
7. Local app reports and generated Autopilot reports.
8. OpenSpec changes, tasks, and archived decisions.
9. Version drift between README, package files, deployments, and health output.

Later, after explicit approval, add richer signals:

1. Browser smoke checks for selected dashboards.
2. Log summaries from approved non-secret log sources.
3. Dependency and vulnerability reports.
4. User-reported issues or chat snippets pasted by Kevin.

## Bug Detection Model

Autopilot should not claim a bug from a single weak signal. It should classify
bug confidence:

1. `suspected`: weak signal, needs more evidence.
2. `likely`: repeated failure, failing check, or clear docs/runtime mismatch.
3. `confirmed`: reproducible failure or trusted health/check evidence.

Every bug candidate should include:

1. Observed symptom.
2. Evidence source.
3. Affected repo/service.
4. Expected behavior.
5. Actual behavior.
6. Suggested smallest verification step.
7. Whether it can be safely handled by OpenCode.

## Improvement Detection Model

Autopilot should also look for non-bug work:

1. Repeated manual steps that could be automated.
2. Missing setup or debug instructions.
3. Stale docs or version records.
4. Fragile config or hard-coded paths.
5. Unverified behavior that should have tests.
6. UI or workflow friction that blocks real use.
7. Existing prototype features that should be hardened.

## Planning Loop

Each cycle should produce a durable planning record:

```text
Observe -> Generate candidates -> Score -> Classify -> Plan next action -> Report
```

Candidate categories:

1. `bug_watch`: possible bug, needs more evidence.
2. `bug_fix_candidate`: likely/confirmed bug with low-risk fix path.
3. `improvement_candidate`: useful adjustment or hardening opportunity.
4. `prototype_candidate`: small runnable prototype opportunity.
5. `needs_kevin_decision`: product, user-flow, cost, deployment, or data risk.
6. `blocked`: unsafe or forbidden.

## Dashboard Direction

The dashboard should add an `Observation` area with:

1. Current project health summary.
2. Suspected bugs.
3. Improvement candidates.
4. Needs Kevin decision.
5. Recently ignored or deferred items.
6. Evidence and last observed timestamp.

## Autonomy Boundary

v0.6 should still be planning-first. It may prepare OpenCode prompts and plans,
but should not auto-edit projects until Kevin explicitly approves an automation
mode for that category.

Future automation can start with low-risk tasks only:

1. Docs mismatch fixes.
2. Missing verification notes.
3. Small tests.
4. Obvious typo or stale version references.
5. Small bug fixes that do not affect user flow or API contracts.
