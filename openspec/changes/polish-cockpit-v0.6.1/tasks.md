## 1. Background Graph Refresh

- [x] 1.1 Refresh the Autopilot-owned idea graph at the end of every successful background observation run.
- [x] 1.2 Add `lastGraphAt` to `ObservationLoopState` and stamp it after each refresh.
- [x] 1.3 Poll `/api/observation-loop` from the cockpit once a minute and reload the page when `lastGraphAt` changes; show a one-line refresh status under the double status panel.

## 2. Dream-As-Metaphor Cleanup

- [x] 2.1 Remove the literal `電子羊` deterministic research seed and the special-case dream node titles/summaries.
- [x] 2.2 Generalize node summaries and thinking text so dreaming reads as a capability and metaphor, not a literal keyword.
- [x] 2.3 Filter legacy literal `電子羊` / "electric sheep" nodes when loading `data/idea-graph.json` so old stores stop surfacing them.
- [x] 2.4 Update tests for proactive nodes, research seeds, and graph merge behavior to match the new wording and filter.

## 3. Cockpit Layout Stability

- [x] 3.1 Scope the `.idea` desktop-card CSS to `a.idea` so brain-node IDEA buttons no longer inherit the wrong rule.
- [x] 3.2 Drop the hover `scale(1.05)` on `.brain-node` and use `z-index`, border, background, and glow changes for focus feedback.
- [x] 3.3 Cap `.node-title` with `-webkit-line-clamp: 4` and `.brain-node` with `max-height`, so long IDEA text does not tower over neighbours.
- [x] 3.4 Set `.neural-stage` to `height: clamp(520px, 62vh, 720px)`, switch `.neural-shell` to `align-items: start`, and let `.cockpit-panel` scroll internally so the stage and node positions are independent of right-panel content size.

## 4. Verification And Release

- [x] 4.1 Update `README.md`, `AGENTS.md`, `src/version.ts`, `package.json`, `package-lock.json`, and `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` for `0.6.1`.
- [x] 4.2 Run `npm run build` and `npm test` (38/38 passing locally).
- [x] 4.3 Smoke test in a locally-built Docker container (`http://127.0.0.1:3033`) against shared `data/`; confirm hover/select no longer moves nodes and the cockpit auto-refreshes after a background observation completes.
- [ ] 4.4 Commit, push, and verify the deploy-dev workflow brings `https://kevin.sisihome.org/health` to version `0.6.1`.
