## Context

The current Kevin Autopilot home page has grown from a read-only observer into a mixed dashboard: background loop status, project radar, observation workbench, idea cards, thinking trace, and debug tables all compete for attention. Kevin's clarified goal is different: he wants to open Kevin Autopilot like a visible double's brain, even when he does not type anything, and explore what the double is thinking through a neural-network-like map.

The double must feel proactive and personal without pretending to have unsafe autonomy. It can observe configured project signals, remember Autopilot-owned ideas, generate research seeds, dream up speculative associations, connect new ideas to existing projects, and produce bounded OpenCode handoffs. It still cannot mutate target repositories, deploy, push, read unmanaged secrets, or perform destructive actions.

## Goals / Non-Goals

**Goals:**

1. Make the home page graph-first: Kevin should first see a living idea/research/project network, not a report table.
2. Make the double's visible thinking inspectable: every selected node should explain what it is, why it exists, why it is connected, and what the double wants to explore next.
3. Support Kevin's fast typed idea capture without making manual input required for the cockpit to be useful.
4. Persist graph nodes and edges in Autopilot-owned data so the network has continuity across days.
5. Let the background loop generate read-only daily nodes such as research seeds, project anomaly signals, integration suggestions, and OpenCode task candidates.
6. Make speculative dream nodes feel intentional while clearly labeling them as dream/research seeds rather than evidence-backed findings.
7. Keep first implementation small: SVG or lightweight DOM graph, no external graph service, no voice input, no autonomous mutation.

**Non-Goals:**

1. No speech, voice, or transcription input.
2. No automatic implementation, commit, push, deploy, or target-repo writes.
3. No unmanaged secret reading or broad file content indexing.
4. No full semantic vector database in the first version.
5. No private chain-of-thought exposure; only reviewable thinking summaries and rationale artifacts.

## Decisions

### Decision 1: Graph-first cockpit over dashboard-first layout

The home route should lead with a neural cockpit: center node, related nodes, visible edges, selected-node panel, and a small text capture affordance. Status panels, debug tables, and full reports move behind secondary sections.

Alternatives considered:

1. Keep dashboard and add a graph section. Rejected because it preserves the current confusion: the graph becomes another widget instead of the product metaphor.
2. Build a separate `/brain` page. Deferred because Kevin wants the product identity itself to feel like the double's brain, not a hidden experiment.

### Decision 2: Typed graph records before rich AI/vector infrastructure

The first graph should use explicit typed nodes and edges derived from existing records: ideas, extracted keywords, configured projects, observation candidates, research seeds, extensions, and tasks. Similarity can remain deterministic keyword/project matching first, then AI can enrich summaries when configured.

Alternatives considered:

1. Add a vector store immediately. Deferred because it adds operational complexity before the UI metaphor is proven.
2. Keep only ephemeral graph rendering from the latest observation report. Rejected because Kevin wants continuity and a sense that the double's brain grows over time.

### Decision 3: Visible thinking summaries, not model chain-of-thought

Each node should show a structured "I understand this as..." panel with keywords, related projects, why it matters, evidence, confidence, and next exploration options. This is a generated artifact, not private provider chain-of-thought.

Alternatives considered:

1. Show raw prompts or hidden reasoning. Rejected for safety and noise.
2. Show only final labels. Rejected because Kevin explicitly wants to see the double thinking.

### Decision 4: Read-only proactive research seeds

The background loop may create new Autopilot-owned `research` and `extension` nodes from configured project signals, existing ideas, keyword recurrence, and optionally approved web-search sources in a later phase. The first version can generate deterministic research seeds and queries without fetching the public web.

Alternatives considered:

1. Full web search in v0.6. Deferred until source allowlists, quotas, timeouts, and result provenance are designed.
2. No proactive nodes. Rejected because Kevin wants to open the page without typing and still see something worth exploring.

## Risks / Trade-offs

1. Graph could become visual noise → Limit first view to a focused subgraph and provide filters by node type.
2. The double could look fake if generated nodes are low-quality → Require each proactive node to include why it exists, evidence/source, and confidence.
3. The UI could hide actionable work too much → Selected-node actions must include "extend", "find relationships", "turn into OpenCode task", "mark interesting", and "stop exploring this" where safe.
4. Persistent graph data could grow without cleanup → Store timestamps, source IDs, and archived/ignored status so old or low-value nodes can be filtered later.
5. Web research could introduce cost, latency, or untrusted data → Treat web search as a later phase behind allowlists, per-item timeouts, quotas, and provenance.

## Migration Plan

1. Add graph data types and storage alongside existing idea/observation data.
2. Generate graph records from existing ideas, project radar, observation candidates, and the background loop.
3. Replace the home page first screen with Neural Cockpit while keeping old debug/report sections below or behind details.
4. Keep existing `/api/report`, `/api/ideas`, `/api/main-agent/thinking`, and loop APIs compatible.
5. Add new graph APIs for reading the focused graph and extending a selected node.
6. Bump the app version and update README/AGENTS/deploy expected version during implementation.

Rollback is simple because the graph is Autopilot-owned additive data: the app can ignore graph records and render the previous report sections if needed.

## Open Questions

1. Should the first graph renderer use plain SVG/DOM in `src/web.ts`, or is this the point to introduce a frontend bundle later?
2. Should "extend this node" call AI immediately when keys are available, or first create deterministic extension candidates and mark AI as a later enhancement?
3. Should proactive web search be part of this change or a follow-up after source allowlists and quotas are specified?
