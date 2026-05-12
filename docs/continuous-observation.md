# Continuous Observation Plan

## Expectation

Kevin expects Autopilot to continuously watch different projects, notice bugs or
weak signals, and proactively plan useful adjustments without waiting for a
manual idea submission.

The intended behavior is Kevin's product-engineering brain in service form. It
should not wait like a chatbot. It should actively look for real pain, repeated
manual work, broken or fragile workflows, unverified behavior, and opportunities
to build a small useful tool or prototype.

The system should behave like an always-on observer:

1. Look across configured projects.
2. Detect possible bugs, regressions, stale behavior, and broken checks.
3. Notice places that can be simplified, hardened, documented, tested, or turned
   into a better workflow.
4. Keep a living backlog of things worth doing.
5. Decide whether each item is safe to auto-prepare, needs Kevin approval, or
   should only be observed.

## Product-Engineering Brain

Autopilot should continuously ask Kevin-style questions:

1. Who is currently stuck or doing repetitive work?
2. What workflow is messy, manual, fragile, or under-documented?
3. What is the smallest runnable prototype that would prove value?
4. What existing behavior could be broken if this is changed?
5. What evidence would prove the bug or improvement is real?
6. What can be prepared safely without bothering Kevin?
7. What needs Kevin's decision because it changes user flow, data, deployment,
   API contract, cost, or existing habits?

This means Autopilot should produce useful artifacts, not only summaries:

1. Bug hypotheses with evidence and verification steps.
2. Improvement candidates with why-now reasoning.
3. Prototype briefs for small tools or automations.
4. Bounded OpenCode prompts.
5. A durable backlog that survives across observation cycles.
6. Clear approval questions only when the decision cannot be researched.

v0.5.9 adds a visible Kevin sub-persona main agent loop to the dashboard. The
loop is deterministic and read-only: it shows self-Q&A rounds, feasible options,
an active task snapshot, and a recommendation based on current observations plus
Kevin's stored supplements.

v0.5.14 adds an idea desktop below the main decision center. Stored ideas are
clickable cards, and each card shows what the Kevin double is currently doing for
that idea, whether approval is needed, and whether the idea resembles an existing
configured HomeProject repository or service.

v0.5.15 starts the first idle background observation loop. In Web mode, Autopilot
automatically runs read-only observation on a configured interval and shows last
run, next run, running state, run count, and last error on the dashboard and
`/api/observation-loop`. The loop only produces Autopilot-owned reports and
status; it does not perform implementation, commits, pushes, deployment, secret
reads, or destructive actions.

v0.5.16 makes the background agent's thinking trace visible. The dashboard and
`/api/main-agent/thinking` show the current task, role self-Q&A rounds, candidate
evidence, feasible options, and recommendation so Kevin can inspect why the
double chose a next action without exposing private model chain-of-thought.

v0.5.17 adds a quality gate for that visible thinking. Every observation report
now includes a Kevin-style review score and verdict, so weak thinking is labeled
as needing more context or not qualified instead of being presented as if it were
Kevin-quality judgment.

v0.5.18 makes the quality gate actionable by recording what evidence is missing
and what condition would upgrade the signal. Weak suspected candidates are routed
to evidence collection instead of read-only handoff.

v0.5.19 surfaces the all-project Project Radar from the same read-only signals.
Each configured repository/service appears on the dashboard with status, linked
signals, and the next observation step, making it clear that the loop watches the
whole HomeProject surface even though the command center chooses one focus.

v0.5.20 keeps the same full observation loop but changes the dashboard from a
single visible candidate to a multi-item Priority Board. A run can now surface
ten-plus ranked candidates without hiding them in debug tables; each card still
uses read-only evidence and collapsed bounded prompts.

Kevin can add a supplement during or between observation cycles. The supplement
is stored as Autopilot-owned data and merged into the next cycle as context; it
does not reset the main task, overwrite the observation backlog, or authorize
repo edits.

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

Background observation is now allowed when it stays read-only and records worker
state. Background execution that mutates target repositories, commits, pushes,
deploys, or changes service state is still not allowed until the design includes
scheduler state, permission gates, interrupt classification, pending action
records, health/status surfaces, and explicit Kevin approval.

Future automation can start with low-risk tasks only:

1. Docs mismatch fixes.
2. Missing verification notes.
3. Small tests.
4. Obvious typo or stale version references.
5. Small bug fixes that do not affect user flow or API contracts.
