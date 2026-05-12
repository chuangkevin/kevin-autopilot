## Why

Kevin Autopilot currently reads like a dashboard/reporting surface, but Kevin wants to open it like a visible product-engineering double: a living brain that can notice project signals, grow ideas, show associations, dream about "electric sheep" style speculative directions, and invite exploration even when Kevin does not type anything.

This change reframes the home experience around a neural idea graph so Kevin can quickly see what the double is thinking, which ideas are connected, what can be extended, and which outputs can become safe OpenCode handoffs.

## What Changes

- Replace the dashboard-first home screen with a graph-first Neural Cockpit centered on Kevin Autopilot's active thought network.
- Represent ideas, keywords, projects, signals, research seeds, extensions, and OpenCode tasks as visible graph nodes with typed relationships.
- Add node exploration: selecting a node shows what it is, why the double connected it, related nodes, visible thinking notes, and safe next actions.
- Distinguish dream-like speculative nodes from evidence-backed project signals so the UI feels alive without pretending dreams are facts.
- Keep plain-text idea capture as a secondary fast input for Kevin's typed thoughts, not the only way the page has useful content.
- Add read-only proactive idea/research seed generation so the cockpit can show "today I thought of" nodes without requiring manual input.
- Preserve the existing read-only boundary: the double may observe, store Autopilot-owned graph records, generate prompts, and propose research; it must not mutate target repos, deploy, push, read unmanaged secrets, or perform destructive actions.

## Capabilities

### New Capabilities

- `neural-cockpit`: Graph-first home UI and node exploration workflow for the Kevin Autopilot double.
- `idea-graph`: Autopilot-owned graph data model for idea, keyword, project, signal, research, extension, and task nodes plus typed edges.
- `double-research-loop`: Read-only proactive thinking loop that generates visible research seeds, idea extensions, and project-integration suggestions.

### Modified Capabilities

- None.

## Impact

- Affects `src/web.ts` home rendering and related tests.
- Adds or extends Autopilot-owned data storage for graph nodes, edges, and extension records under ignored `data/`.
- Extends observation/idea analysis code to produce graph-ready nodes and visible thinking summaries.
- May add lightweight client-side SVG or canvas graph rendering; no external graph service is required for the first version.
- Requires README/AGENTS/version/deploy expected-version updates when implemented.
