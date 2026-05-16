## ADDED Requirements

### Requirement: Candidate Evaluations Explain Ranking

Kevin Autopilot SHALL compute a visible evaluation for every accepted `ProblemBrief` so Kevin can understand why each candidate is worth chasing, needs evidence, or should not be pursued now.

#### Scenario: Candidate is worth chasing
- **WHEN** a problem brief has a named people group, a concrete workflow, at least one useful workaround or repeated pain signal, a Kevin-fit rationale, and a plausible validation step
- **THEN** the candidate evaluation SHALL assign tier `worth_chasing`, SHALL include a ranking rationale, and SHALL include a next validation step.

#### Scenario: Candidate needs more evidence
- **WHEN** a problem brief is plausible but lacks a second independent signal, real sample, clear workaround, or sharp validation path
- **THEN** the candidate evaluation SHALL assign tier `needs_evidence` and SHALL state the most important evidence gap.

#### Scenario: Candidate should not be pursued now
- **WHEN** a signal is internal engineering-only, tech-only, lacks people/workflow, duplicates an existing brief, or is too abstract to validate
- **THEN** Kevin Autopilot SHALL classify it under a rejected or downranked reason instead of presenting it as an implementation-ready candidate.

### Requirement: Candidate Feedback Is Autopilot-Owned And Trusted-Gated

Kevin Autopilot SHALL allow Kevin to record lightweight feedback on problem candidates while preserving the read-only boundary for target projects.

#### Scenario: Trusted feedback write
- **WHEN** a trusted request posts feedback action `interesting`, `boring`, `not-a-problem`, or `find-similar` for a known problem brief
- **THEN** Kevin Autopilot SHALL persist an Autopilot-owned feedback record, update the candidate evaluation, and SHALL NOT modify target repositories, deploy services, contact external users, spend money, or approve implementation.

#### Scenario: Untrusted feedback write
- **WHEN** an untrusted request posts candidate feedback
- **THEN** Kevin Autopilot SHALL reject the request with 403 and SHALL NOT write feedback metadata.

#### Scenario: Feedback affects future ranking
- **WHEN** a candidate has feedback records
- **THEN** ranking SHALL account for that feedback, promoting `interesting` / `find-similar` candidates and downranking `boring` / `not-a-problem` candidates unless new evidence materially improves the brief.

### Requirement: Rejected Summary Is Visible And Sanitized

Kevin Autopilot SHALL summarize rejected or downranked problem signals so Kevin can see that filtering happened without exposing full private snippets publicly.

#### Scenario: Public daily endpoint includes rejected counts
- **WHEN** `GET /api/problem-discovery/daily` returns problem discovery data
- **THEN** it MAY include rejected reason counts and short sanitized examples, but SHALL NOT include full rejected signal snippets, full evidence arrays, unmanaged secrets, or the full internal `briefs` array.

#### Scenario: Dashboard shows rejected summary
- **WHEN** the dashboard renders the candidate pool
- **THEN** it SHALL show a collapsed or secondary summary of rejected/downranked categories such as internal engineering, tech-only, missing people, missing workflow, duplicate, or low signal.

### Requirement: Candidate Pool Shows Validation Cards

Kevin Autopilot SHALL show a compact validation card for each visible candidate so Kevin can decide the next low-risk action.

#### Scenario: Candidate card renders validation details
- **WHEN** a candidate appears in the `今日真實問題` candidate pool
- **THEN** its card SHALL show people, workflow, tier, ranking rationale, evidence gap, next validation step, and at least one kill criterion or rejection condition.

#### Scenario: Mobile first screen remains problem-focused
- **WHEN** Kevin opens the dashboard on a mobile viewport
- **THEN** the daily pick and top candidate evaluations SHALL remain readable without opening the graph tab.
