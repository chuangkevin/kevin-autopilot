# neural-cockpit Specification

## Purpose
Kevin Autopilot's primary user interface: a cyberpunk neural cockpit rendered as a full-page web app with a tab bar (分身/Backlog/圖/想法), an SVG neural map with labeled graph nodes, hub-spoke focus interaction, AI reflection status, and a runtime-overrides settings page. Mobile shows the graph tab by default; desktop shows a 3-column layout.
## Requirements
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

### Requirement: Hub-Spoke Click Focus
Kevin Autopilot SHALL re-center the cockpit graph on a node when Kevin clicks it, arranging that node's direct neighbours as the visible inner ring and de-emphasizing or hiding non-neighbours.

#### Scenario: Click a non-center node
- **WHEN** Kevin clicks a `brain-node` other than the currently focused node
- **THEN** the clicked node is rendered at the stage center, every node with a direct edge to it is laid out on the inner ring, non-neighbour nodes are visually faded or pushed to an outer ring, and the right-side drawer still loads the node detail.

#### Scenario: Click the currently focused node
- **WHEN** Kevin clicks the node that is already the focused center
- **THEN** the layout returns to the default `centerNodeId`-rooted view with all nodes visible and no faded state.

#### Scenario: Click empty stage or press Escape
- **WHEN** Kevin clicks the empty stage area, or presses Escape while the cockpit is focused
- **THEN** the layout returns to the default `centerNodeId`-rooted view.

#### Scenario: Large neighbourhood graph
- **WHEN** the focused node has more than 14 non-neighbour nodes in the loaded graph
- **THEN** the cockpit shows the focused node plus its neighbours plus the first 14 non-neighbours faded on an outer ring, and displays a `+N hidden` indicator for the remainder.

### Requirement: Edge Rationale Visible When Focused
Kevin Autopilot SHALL make the relationship rationale readable without requiring hover, for every edge incident to the focused node.

#### Scenario: Edge rationale on focused node
- **WHEN** a node is focused via hub-spoke click
- **THEN** every edge incident to that node renders an inline label drawn from `edge.rationale`, truncated for readability and accessible to touch input, in addition to the existing `<title>` hover tooltip.

#### Scenario: Edge rationale on unfocused state
- **WHEN** no node is focused or the default layout is shown
- **THEN** edges render without inline labels, matching pre-v0.10.0 behaviour, so the default cockpit view stays uncluttered.

### Requirement: Graph-First Home Cockpit
Kevin Autopilot SHALL present the home page as a neural cockpit centered on the visible Kevin Autopilot double rather than as a report-first dashboard.

#### Scenario: Open home page without typing
- **WHEN** Kevin opens the home page without submitting new text
- **THEN** the page shows a visible graph of current thought nodes and relationships, plus a concise double status summary.

#### Scenario: Preserve read-only boundary
- **WHEN** the cockpit shows generated ideas, research seeds, project signals, or task candidates
- **THEN** it clearly states that Kevin Autopilot may observe and prepare artifacts but does not modify target repos, commit, push, deploy, read unmanaged secrets, or run destructive actions.

### Requirement: Node Selection Panel
Kevin Autopilot SHALL allow Kevin to select a graph node and inspect what the double understands about that node.

#### Scenario: Select graph node
- **WHEN** Kevin selects a graph node
- **THEN** the page shows the node type, summary, source, connected nodes, visible thinking summary, confidence, and safe next actions.

#### Scenario: Node has no strong evidence
- **WHEN** Kevin selects a node based on weak or suspected evidence
- **THEN** the panel marks it as needing more evidence instead of presenting it as implementation-ready.

### Requirement: Exploration Actions
Kevin Autopilot SHALL expose exploration actions from a selected node without treating them as autonomous mutation approval.

#### Scenario: Extend selected node
- **WHEN** Kevin chooses to extend a selected node
- **THEN** Kevin Autopilot creates or previews Autopilot-owned extension/research nodes linked to the selected node without changing target repositories.

#### Scenario: Convert to OpenCode task
- **WHEN** Kevin chooses to turn a qualified node into an OpenCode task
- **THEN** Kevin Autopilot shows a bounded prompt and approval/risk context for copying, not automatic execution.

### Requirement: Fast Typed Capture
Kevin Autopilot SHALL keep a fast plain-text capture path for Kevin's typed thoughts, but the cockpit SHALL remain useful even when no text is entered.

#### Scenario: Capture typed idea
- **WHEN** Kevin submits a plain-text idea from the cockpit
- **THEN** the idea is stored as an Autopilot-owned idea node, keywords are extracted, project relationships are suggested, and the graph updates with related nodes.

#### Scenario: No manual input
- **WHEN** Kevin has not submitted a new idea recently
- **THEN** the cockpit still shows proactive nodes from observation, stored ideas, project signals, and research seeds.

### Requirement: Cyberpunk Android Mode UI
Kevin Autopilot SHALL render the dashboard as a full-screen cyberpunk neural cockpit with a bottom tab bar, an SVG neural map, scanline overlay, and a cyan/magenta palette.

#### Scenario: Tab bar layout
- **WHEN** Kevin opens the home page
- **THEN** the page SHALL render four tab buttons at the bottom: 圖 (graph neural map), 分身 (brain/loop status), Backlog, 想法 (idea capture).

#### Scenario: Mobile default tab
- **WHEN** Kevin opens the home page on a mobile-sized viewport
- **THEN** the 圖 tab SHALL be visible by default without requiring a tap.

#### Scenario: Desktop layout
- **WHEN** the viewport is ≥ 768 px wide
- **THEN** the page SHALL switch to a 3-column CSS grid (sidebar | main | sidebar) with max-width 1400 px, showing all tab content simultaneously.

#### Scenario: SVG neural map with labeled nodes
- **WHEN** the graph tab renders the neural map SVG
- **THEN** each node SHALL display a visible `<text>` label (title truncated to 12 chars for center, 8 chars for peripheral nodes) in the node's color (cyan for normal, magenta for interesting, dimmed for stop-exploring), in addition to the existing `<title>` tooltip.

### Requirement: Settings Page Hosts Runtime Overrides Section
Kevin Autopilot's `/settings` page SHALL render a "Runtime Overrides" section listing every whitelisted toggle with its current effective value, an indicator of whether the field is overridden or using the file-config default, and a control to change it (checkbox for booleans, number input for numerics) plus a "Reset to default" action.

#### Scenario: Render current effective values
- **WHEN** Kevin opens `/settings`
- **THEN** the Runtime Overrides section SHALL show each whitelisted field's current effective value, mark it as "已覆蓋" / "預設" so Kevin can see which fields are overridden, and offer a control to change it.

#### Scenario: Toggle a boolean override
- **WHEN** Kevin flips a boolean control in the Runtime Overrides section
- **THEN** the page SHALL `PUT /api/runtime-overrides` with the new value, on 200 the section SHALL re-render with the override applied, and no container restart SHALL be required for the change to take effect on the next observation cycle.

#### Scenario: Reset a field to default
- **WHEN** Kevin clicks "Reset to default" on a field whose effective value is currently overridden
- **THEN** the page SHALL `PUT /api/runtime-overrides` with that field set to `null`, the section SHALL re-render showing the file-config default value, and the field SHALL be marked "預設" again.

### Requirement: Cockpit Status Reflects Effective Config
Kevin Autopilot SHALL render the cockpit reflection-status line and observation-loop status using the effective config (overrides merged), so the user sees the same values that the observation loop and reflection module are actually using.

#### Scenario: Override changes pendingAiIdeasCap
- **WHEN** the effective `aiReflection.maxPendingAiIdeas` differs from the file-config value
- **THEN** the cockpit reflection-status line SHALL display the effective cap (e.g. `pending 2/10`), and the `pendingAiIdeasCap` field of `GET /api/reflection/state` SHALL match the override.

#### Scenario: Override disables background observation
- **WHEN** the effective `backgroundObservation.enabled` is false because of an override
- **THEN** the cockpit's 背景 chip SHALL render `手動` and `GET /api/observation-loop` SHALL report `enabled: false`, regardless of the file-config value.

