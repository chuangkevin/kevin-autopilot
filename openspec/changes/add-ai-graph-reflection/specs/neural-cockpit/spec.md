## ADDED Requirements

### Requirement: Cockpit Surfaces Reflection Status
Kevin Autopilot SHALL render a concise reflection status line at the top of the Neural Cockpit summarising the latest reflection outcome and current pending AI-idea count.

#### Scenario: Reflection ran successfully
- **WHEN** the latest reflection succeeded
- **THEN** the cockpit SHALL show "上次反思：HH:MM · pending AI 想法 {n}/{cap}" so Kevin can see the double actually thought.

#### Scenario: Reflection was skipped because nothing changed
- **WHEN** the latest reflection was skipped with `reason: 'unchanged'`
- **THEN** the cockpit SHALL show a muted variant like "上次反思：HH:MM · 圖未變化" so Kevin knows the no-op is intentional.

#### Scenario: Reflection is offline
- **WHEN** the latest reflection was skipped with `reason: 'offline'`, `'error'`, or `'disabled'`
- **THEN** the cockpit SHALL show "反思離線：{detail}" with a muted style, and SHALL NOT claim that the double thought this cycle.

### Requirement: AI Idea Cards Are Labelled And Dismissible
Kevin Autopilot SHALL render AI-generated IDEA cards with an "AI 生" pill and a one-click dismiss button bound to `POST /api/ideas/:id/dismiss`.

#### Scenario: Cockpit shows an AI-generated idea
- **WHEN** the visible idea list includes an `IdeaRecord` with `aiSource = 'ai-reflection'`
- **THEN** its IDEA card and its idea-graph IDEA node SHALL display an "AI 生" pill, an audit line referencing `aiReflection.evidence`, and a dismiss button.

#### Scenario: Kevin dismisses an AI-generated idea
- **WHEN** Kevin clicks the dismiss button on an AI idea
- **THEN** the cockpit SHALL POST to `/api/ideas/:id/dismiss`, on 200 SHALL remove the card from the UI inline, and the next graph refresh SHALL no longer include the dismissed idea as a node.

### Requirement: Focused Node May Render AI-Rewritten Next Exploration
Kevin Autopilot SHALL, when rendering a focused node detail, prefer an AI-rewritten `thinking.nextExploration` over the deterministic value only when the latest successful reflection record targets that node id and the rewrite is no older than 1 hour.

#### Scenario: AI rewrite is current
- **WHEN** the focused node id matches a `nextExplorationRewrites[].nodeId` in a reflection record younger than 1 hour
- **THEN** the cockpit SHALL render the AI text as the node's "下一步" and SHALL show a small "AI 改寫" tag next to it.

#### Scenario: AI rewrite is stale
- **WHEN** the latest reflection record is older than 1 hour or did not include a rewrite for the focused node
- **THEN** the cockpit SHALL render the deterministic `thinking.nextExploration` and SHALL NOT show the "AI 改寫" tag.
