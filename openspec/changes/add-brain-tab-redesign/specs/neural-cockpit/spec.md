## ADDED Requirements

### Requirement: Selected Node Card Surfaces Keywords And Discussion First On Mobile

When a node is selected on the `/分身` tab, the right-side card SHALL render keywords directly under the node title in an accent-coloured strip that wraps to multiple lines and never ellipsizes, and SHALL render the full `thinking.understanding`, `whyItMatters`, `nextExploration`, `questions`, `evidence`, and `missingEvidence` content without truncation. Low-value meta (`type · confidence · source`, timestamps, the existing `extend` / `find-relationships` / `copy-opencode-prompt` / `mark-interesting` actions, and the OpenCode prompt) SHALL collapse into a `🔬 詳情 ▾` block that is closed by default.

#### Scenario: Mobile renders keyword strip above discussion

- **WHEN** Kevin opens the `/分身` tab on a viewport ≤ 520 px wide and selects a node
- **THEN** the card SHALL render the node title, a wrapping accent-coloured keyword strip with at minimum 14 px font size, and then the full discussion sections in order: 分身怎麼想這個 → 分身正在問 → 相連節點 → 證據 → 缺的證據.

#### Scenario: Discussion is never clipped

- **WHEN** the selected node's combined `thinking.*` content exceeds the viewport height
- **THEN** the cockpit panel SHALL scroll internally to expose every character, and no individual section SHALL apply CSS line-clamp, `text-overflow: ellipsis`, or `white-space: nowrap` to its body content.

#### Scenario: Low-value meta lives in 詳情 block

- **WHEN** Kevin opens the selected-node card
- **THEN** `type · confidence · source`, `createdAt`, `lastSeenAt`, `seenCount`, the four existing actions `extend` / `find-relationships` / `copy-opencode-prompt` / `mark-interesting`, and the OpenCode prompt SHALL be rendered only inside the `🔬 詳情 ▾` collapsible block, closed by default.

### Requirement: Selected Node Action Bar Is Sticky And Carries Three New Actions

The selected-node card SHALL render a sticky action bar at its top containing the three new actions in this order: ⚡ 多想一點 (`boost`), 🧠 深度辯論 (`deliberate`), ❄ 先不要想 (`archive`). The bar SHALL remain visible while the card scrolls internally.

#### Scenario: Action bar stays visible while scrolling

- **WHEN** Kevin scrolls the selected-node card content
- **THEN** the action bar SHALL stay pinned to the top of the card with a translucent backdrop, and all three buttons SHALL remain reachable without scrolling back up.

#### Scenario: Center node hides archive

- **WHEN** the selected node id is the graph's `centerNodeId`
- **THEN** the action bar SHALL render ⚡ 多想一點 and 🧠 深度辯論 but SHALL omit ❄ 先不要想, because archiving the center node is not allowed.

### Requirement: Boost And Deliberate Actions Use Polling UX

The ⚡ 多想一點 and 🧠 深度辯論 actions SHALL each disable their button on click, POST the corresponding endpoint, and poll the matching status endpoint every 3 seconds until the action completes or fails.

#### Scenario: Boost click flow

- **WHEN** Kevin taps ⚡ 多想一點
- **THEN** the button SHALL show "辯論進行中…" wording adapted as "深化進行中…", SHALL be disabled, SHALL `POST /api/idea/:id/boost`, and SHALL poll `GET /api/idea/:id/boost-status` every 3 s; on `status: 'idle'` with an updated `updatedAt`, the page SHALL reload to show the new content.

#### Scenario: Deliberation click flow with anchor

- **WHEN** Kevin taps 🧠 深度辯論 on a selected non-center node
- **THEN** the request SHALL `POST /api/deliberation` with body `{ anchorNodeId: <selected id> }`, the button SHALL be disabled, and the existing deliberation polling UX SHALL apply.

#### Scenario: 409 surfaces friendly status

- **WHEN** either endpoint returns `409 { status: 'already_running' }`
- **THEN** the card SHALL show a muted status line "已經在想了…" without re-enabling the button until the polling reports completion.

### Requirement: Frozen Vault Inline View Lists Archived Nodes

The `/分身` tab header SHALL render a `❄ 冷凍庫 (N)` chip when N archived nodes exist; tapping the chip SHALL swap the workbench section to a frozen-vault inline view listing each archived node with its title, keyword strip, archived timestamp, `seenCount`, a 🔥 解凍 button, and a 🗑 永久刪除 button. The chip SHALL be hidden when N = 0.

#### Scenario: Chip reflects archived count

- **WHEN** the loaded graph contains N nodes with `archived === true`
- **THEN** the chip SHALL render `❄ 冷凍庫 (N)` when N > 0, and SHALL be hidden when N = 0.

#### Scenario: Switch to vault view

- **WHEN** Kevin taps the `❄ 冷凍庫` chip
- **THEN** the workbench section SHALL replace the graph + selected-node view with a vault list of archived nodes, and SHALL render a `← 回腦圖` button that restores the graph view on tap.

#### Scenario: Unarchive returns node to graph

- **WHEN** Kevin taps 🔥 解凍 on a vault row
- **THEN** the row SHALL `POST /api/idea/:id/unarchive`, and on 200 the row SHALL disappear from the vault and the node SHALL reappear in the default graph on next render.

#### Scenario: Permanent delete is confirmed

- **WHEN** Kevin taps 🗑 永久刪除 on a vault row
- **THEN** the UI SHALL ask for a single `confirm()` confirmation before sending `DELETE /api/idea/:id`, and on 200 the row SHALL disappear and the node and its incident edges SHALL be removed from the graph.

### Requirement: Mobile Cockpit Panel Fills Viewport Below Graph

On viewports ≤ 520 px wide, `.cockpit-panel` SHALL size itself to `calc(100dvh - var(--cy-h, 48dvh) - 160px)` with `max-height: none` and `overflow-y: auto`, and `.node-drawer` SHALL NOT impose any inner `max-height` or `overflow-y` constraint.

#### Scenario: Card consumes remaining viewport

- **WHEN** Kevin opens the `/分身` tab on a 360 px-wide or 414 px-wide viewport
- **THEN** the cockpit panel SHALL extend from immediately below the graph to immediately above the bottom tab bar, with no large empty band below the card.

#### Scenario: Inner drawer does not double-scroll

- **WHEN** the cockpit panel renders the selected-node detail
- **THEN** `.node-drawer` SHALL grow naturally to its content height with no inner scrollbar, and only the outer `.cockpit-panel` SHALL provide a single scroll container.

## MODIFIED Requirements

### Requirement: Node Selection Panel

Kevin Autopilot SHALL allow Kevin to select a graph node and inspect what the double understands about that node. On mobile, the panel SHALL prioritise keywords and the full thinking discussion over low-value meta.

#### Scenario: Select graph node

- **WHEN** Kevin selects a graph node
- **THEN** the page SHALL render the node title, keyword strip, full thinking discussion, connected nodes, evidence, missing evidence, and a `🔬 詳情 ▾` collapsible block containing the node type, confidence, source, timestamps, `seenCount`, the four existing exploration actions, and any OpenCode prompt.

#### Scenario: Node has no strong evidence

- **WHEN** Kevin selects a node based on weak or suspected evidence
- **THEN** the panel SHALL mark it as needing more evidence instead of presenting it as implementation-ready, and the keyword strip SHALL still render whatever keywords are stored.

### Requirement: Exploration Actions

Kevin Autopilot SHALL expose a primary sticky action bar carrying ⚡ 多想一點, 🧠 深度辯論, and ❄ 先不要想, and SHALL keep the legacy exploration actions (`extend`, `find-relationships`, `copy-opencode-prompt`, `mark-interesting`) reachable inside the `🔬 詳情 ▾` block. None of these actions SHALL be treated as autonomous mutation approval.

#### Scenario: Boost from primary action bar

- **WHEN** Kevin taps ⚡ 多想一點 on a selected node
- **THEN** Kevin Autopilot SHALL invoke the boost pipeline as defined in the `single-node-boost` capability without modifying any target repository.

#### Scenario: Focused deliberation from primary action bar

- **WHEN** Kevin taps 🧠 深度辯論 on a selected non-center node
- **THEN** Kevin Autopilot SHALL invoke the deliberation engine with the selected node id as `anchorNodeId`, without modifying any target repository.

#### Scenario: Archive from primary action bar

- **WHEN** Kevin taps ❄ 先不要想 on a selected non-center node
- **THEN** Kevin Autopilot SHALL archive the node as defined in the `idea-graph` capability and SHALL remove the node from the default graph render until it is unarchived.

#### Scenario: Extend selected node

- **WHEN** Kevin chooses to extend a selected node from inside the 🔬 詳情 block
- **THEN** Kevin Autopilot SHALL create or preview Autopilot-owned extension/research nodes linked to the selected node without changing target repositories.

#### Scenario: Convert to OpenCode task

- **WHEN** Kevin chooses to turn a qualified node into an OpenCode task from inside the 🔬 詳情 block
- **THEN** Kevin Autopilot SHALL show a bounded prompt and approval/risk context for copying, not automatic execution.

### Requirement: Cyberpunk Android Mode UI

Kevin Autopilot SHALL render the dashboard as a full-screen cyberpunk neural cockpit with a bottom tab bar, an interactive neural graph, scanline overlay, and a cyan/magenta palette. Archived nodes SHALL NOT be rendered in the default neural graph.

#### Scenario: Tab bar layout

- **WHEN** Kevin opens the home page
- **THEN** the page SHALL render four tab buttons at the bottom: 圖 (graph neural map), 分身 (brain/loop status), Backlog, 想法 (idea capture).

#### Scenario: Mobile default tab

- **WHEN** Kevin opens the home page on a mobile-sized viewport
- **THEN** the 圖 tab SHALL be visible by default without requiring a tap.

#### Scenario: Desktop layout

- **WHEN** the viewport is ≥ 768 px wide
- **THEN** the page SHALL switch to a 3-column CSS grid (sidebar | main | sidebar) with max-width 1400 px, showing all tab content simultaneously.

#### Scenario: Interactive neural map with labeled nodes

- **WHEN** the graph tab renders the neural map
- **THEN** each node SHALL display a visible label (title truncated for readability) in the node's colour (cyan for normal, magenta for interesting, dimmed for low-priority), and the layout SHALL respond to user pan/zoom interactions.

#### Scenario: Archived nodes hidden from graph

- **WHEN** the graph renders the active idea graph
- **THEN** any node with `archived === true` SHALL NOT appear in the neural map and SHALL NOT be selectable from the graph; archived nodes are reachable only via the `❄ 冷凍庫` view.
