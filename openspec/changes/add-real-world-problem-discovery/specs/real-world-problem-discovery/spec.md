## ADDED Requirements

### Requirement: Persist Problem Signals With Provenance

Kevin Autopilot SHALL persist raw problem signals from approved sources with enough provenance for Kevin to audit where each signal came from.

#### Scenario: Store public signal

- **WHEN** Kevin Autopilot collects a public signal from an approved source
- **THEN** it SHALL persist `sourceType`, `sourceName`, `title`, `snippet`, `fetchedAt`, and any available `url` and `query`.

#### Scenario: Store Kevin-owned signal

- **WHEN** Kevin enters a supplement, idea, or local observation that should be considered for problem discovery
- **THEN** Kevin Autopilot SHALL persist it as a `kevin-input` or `homeproject` signal without reading unmanaged secrets or modifying target repositories.

#### Scenario: Signal lacks snippet

- **WHEN** a collected item has no usable snippet or evidence text
- **THEN** it SHALL NOT be promoted into a `ProblemBrief`; it may be recorded as skipped diagnostic data.

### Requirement: Extract People Workflow Pain Workaround

Kevin Autopilot SHALL only promote a signal into problem-discovery consideration when it can identify a people group, a workflow, a pain point, and a current workaround or missing workaround.

#### Scenario: Valid workflow pain

- **WHEN** a signal says a specific group repeatedly handles a workflow with Excel, LINE, screenshots, manual copy/paste, paper, file conversion, or platform hopping
- **THEN** Kevin Autopilot SHALL extract `people`, `workflow`, `pain`, and `workaround` fields and keep the source quote as evidence.

#### Scenario: Technology trend without workflow

- **WHEN** a signal only names a new technology, model, framework, protocol, or startup category without naming who is stuck and what workflow is painful
- **THEN** Kevin Autopilot SHALL reject or downrank it and SHALL NOT make it the daily pick.

#### Scenario: News event converted to workflow pain

- **WHEN** a news item describes a law, policy, platform, pricing, or market change
- **THEN** Kevin Autopilot SHALL only create a problem brief if it can name the affected people group and the workflow that became more painful.

### Requirement: Problem Briefs Are Evidence-Backed Product Opportunities

Kevin Autopilot SHALL produce `ProblemBrief` records that describe a real-world problem and a Kevin-fit product opportunity in a readable, auditable format.

#### Scenario: Create problem brief

- **WHEN** one or more signals support the same problem pattern
- **THEN** Kevin Autopilot SHALL create or update a `ProblemBrief` containing `people`, `workflow`, `pain`, `workaround`, evidence quotes, `existingSolutionsGap`, `severity`, `kevinFit`, `mvp`, `validationPlan`, and `killCriteria`.

#### Scenario: Update existing brief

- **WHEN** a new signal matches an existing problem brief's deduplication key
- **THEN** Kevin Autopilot SHALL add evidence or update timestamps on the existing brief instead of creating a duplicate.

#### Scenario: Missing validation path

- **WHEN** a candidate cannot describe how Kevin could validate the problem with real users or realistic artifacts
- **THEN** the candidate SHALL be marked as needing evidence and SHALL NOT be selected as a high-confidence daily pick.

### Requirement: Score Kevin-Fit Opportunities

Kevin Autopilot SHALL score problem briefs by evidence quality, severity, workaround clarity, Kevin fit, MVP feasibility, and validation clarity.

#### Scenario: HomeProject precedent match

- **WHEN** a problem resembles one of Kevin's demonstrated patterns such as car/listing operations, media/content production, bureaucratic workflow automation, PM-to-prototype conversion, emotional/memory systems, photo/video-to-CAD, or living-world systems
- **THEN** Kevin Autopilot SHALL explain the match in `kevinFit.rationale` and may increase the Kevin-fit score.

#### Scenario: Existing tools too broad

- **WHEN** the current workaround or existing solution is too broad, expensive, technical, or mismatched to the local workflow
- **THEN** Kevin Autopilot SHALL record that gap as part of the opportunity rationale.

#### Scenario: No plausible small MVP

- **WHEN** Kevin Autopilot cannot describe a one-day to one-week runnable artifact that would test the core risk
- **THEN** the candidate SHALL be downranked and SHALL NOT be shown as the primary recommendation unless no better candidates exist.

### Requirement: Daily Pick Shows One Real Problem First

Kevin Autopilot SHALL expose one `DailyProblemPick` as the default decision surface, using Asia/Taipei date semantics.

#### Scenario: Daily pick exists

- **WHEN** at least one problem brief has enough evidence and a plausible Kevin-fit MVP
- **THEN** `GET /api/problem-discovery/daily` SHALL return the selected brief, why it was picked, and why near-miss candidates were not picked today.

#### Scenario: No strong problem today

- **WHEN** no candidate has enough evidence
- **THEN** the dashboard SHALL show a truthful empty state explaining which evidence is missing instead of filling the page with speculative graph bubbles.

#### Scenario: Same Taipei date

- **WHEN** the daily pick is requested multiple times on the same Asia/Taipei date without a forced regeneration
- **THEN** Kevin Autopilot SHALL return the same persisted pick.

### Requirement: Dashboard Is Problem-First, Graph-Second

Kevin Autopilot SHALL make `今日真實問題` the primary dashboard view and move the graph into a secondary exploration/debug role.

#### Scenario: Open dashboard

- **WHEN** Kevin opens the home dashboard
- **THEN** the first screen SHALL show the daily real-world problem or a truthful insufficient-evidence state, not the graph as the default primary surface.

#### Scenario: Inspect supporting graph

- **WHEN** Kevin chooses to explore relationships among people, workflows, workarounds, projects, or ideas
- **THEN** Kevin Autopilot MAY show the graph as a supporting view, but it SHALL NOT replace the daily problem card.

### Requirement: Read-Only Boundary For Problem Discovery

Kevin Autopilot SHALL keep problem discovery read-only unless Kevin explicitly approves a later execution gate.

#### Scenario: Generate OpenCode prompt

- **WHEN** Kevin Autopilot generates a prompt from a problem brief
- **THEN** the prompt SHALL be bounded to research, spec, or prototype planning and SHALL NOT instruct OpenCode to create repos, deploy, spend money, contact users, or mutate target projects without approval.

#### Scenario: External source requires credentials

- **WHEN** a potential source requires private credentials, membership, paid API access, or posting/interaction
- **THEN** Kevin Autopilot SHALL skip it unless a future approved configuration explicitly enables that source.
