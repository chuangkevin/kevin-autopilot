## 1. Graph Data Foundation

- [x] 1.1 Add TypeScript types for graph node types, edge types, node confidence, visible thinking summary, and selected-node actions.
- [x] 1.2 Add Autopilot-owned graph storage under ignored `data/` with load, save, upsert node, upsert edge, archive/ignore, and focused-subgraph read operations.
- [x] 1.3 Project existing idea records into idea, keyword, project, extension, and task nodes with typed edges.
- [x] 1.4 Project observation candidates and project radar items into signal/project/task nodes with evidence and confidence.
- [x] 1.5 Add tests for graph persistence, restart continuity, deterministic keyword extraction, and relationship rationale text.

## 2. Double Research And Extension Loop

- [x] 2.1 Extend the read-only background observation loop to create proactive research/extension nodes from recurring keywords, stored ideas, project signals, and weak evidence gaps.
- [x] 2.2 Label deterministic research output as research seeds or planned queries when no approved web search source is configured.
- [x] 2.3 Implement selected-node extension generation for research, prototype, existing-project integration, and OpenCode task directions.
- [x] 2.4 Add visible thinking summaries for generated nodes, including why it matters to Kevin, related projects/keywords, missing evidence, and next exploration step.
- [x] 2.5 Add tests that proactive nodes are read-only, provenance-backed, and never claim public web search without configured sources.

## 3. Graph APIs

- [x] 3.1 Add an API endpoint to return the focused graph for the home cockpit.
- [x] 3.2 Add an API endpoint to select or inspect a node and return its details, connected nodes, edges, thinking summary, and safe actions.
- [x] 3.3 Add an API endpoint to extend a selected node by creating or previewing Autopilot-owned extension nodes.
- [x] 3.3a Add metadata-only action APIs for finding relationships, marking a node interesting, and stopping exploration of a node.
- [x] 3.4 Keep existing report, idea, thinking, and observation-loop APIs compatible.
- [x] 3.5 Add API tests for graph read, node detail, extension, and read-only safety behavior.

## 4. Neural Cockpit UI

- [x] 4.1 Replace the home first screen with a graph-first Neural Cockpit using lightweight SVG or DOM rendering without an external graph service.
- [x] 4.2 Add a concise double status panel showing what Kevin Autopilot is currently thinking about, last/next observation, and read-only boundary.
- [x] 4.3 Add a selected-node panel with summary, source, connected nodes, visible thinking, confidence, evidence gaps, and safe actions.
- [x] 4.3a Make all selected-node actions functional: relationship finding adds graph edges, OpenCode task copies a bounded prompt, marking interesting persists, and stop-exploring hides the node from the focused graph.
- [x] 4.4 Keep fast plain-text capture as a secondary input that creates idea nodes and updates graph relationships.
- [x] 4.5 Move existing report/debug/workbench/radar sections behind secondary details so they do not compete with the graph metaphor.
- [x] 4.6 Add responsive mobile behavior for graph exploration, selected-node drawer, and typed capture with 16px+ input text.

## 5. Verification And Release

- [x] 5.1 Update README, AGENTS, app version, package files, and deploy expected version for the Neural Cockpit release.
- [x] 5.2 Run `npm run build` and `npm test`.
- [x] 5.3 Run local smoke tests for `/health`, home cockpit graph, graph API, node detail, node extension, and settings page.
- [x] 5.4 Run reviewer pass for UX clarity, read-only safety, graph/data consistency, and misleading web-research claims.
- [ ] 5.5 Commit, push, restart the local container, and verify CI, image build, and kevinhome deploy workflows.
