## Why

The v0.6.0 Neural Cockpit landed the graph-first home, but two follow-up
problems surfaced once Kevin used it:

1. The cockpit only refreshed graph state when an HTTP request hit it, so the
   "visible double" felt frozen between page loads even when the background
   observation loop kept running.
2. The earlier `.idea` desktop-card rule and the brain-node `idea` type shared
   the same class name. Hovering or clicking an IDEA node on the cockpit
   triggered the desktop-card hover transform, which dropped the
   `translate(-50%, -50%)` centering, snapped the node away from its anchor,
   and forced every other node to shift because the right panel resized the
   shared grid row. Kevin reported it as "整個位移".
3. The `dockerized-observer-v01` flow seeded a literal `電子羊` / "electric
   sheep" speculative node, which read like a real claim rather than a dream
   metaphor.

## What Changes

- Refresh the Autopilot-owned idea graph after every background observation
  run, record `lastGraphAt` in observation-loop state, and have the cockpit
  poll `/api/observation-loop` once a minute so the page reloads itself when
  the double has thought of something new.
- Treat dreaming as a capability and metaphor rather than a literal keyword:
  remove the `電子羊` deterministic research seed, generalize the dream
  language in node summaries, and filter previously stored literal-metaphor
  nodes so old `data/idea-graph.json` files no longer surface them.
- Stabilize the cockpit layout so node positions stay anchored when Kevin
  hovers or selects a node:
  - Scope the `.idea` desktop-card CSS to `a.idea` so brain-node IDEA buttons
    no longer inherit the wrong `min-height` and hover transform.
  - Drop the hover `scale(1.05)` on brain-nodes and use `z-index`, border, and
    glow changes for focus feedback instead.
  - Cap brain-node titles with `-webkit-line-clamp: 4` and the node box with
    `max-height`, so long IDEA text no longer makes one node tower over its
    ring neighbors.
  - Give `.neural-stage` a fixed `height: clamp(520px, 62vh, 720px)`, switch
    `.neural-shell` to `align-items: start`, and let `.cockpit-panel` scroll
    internally, so right-panel content growth never resizes the graph stage
    or moves the percentage-anchored nodes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `idea-graph`: legacy literal "電子羊" / "electric sheep" generated nodes are
  filtered on load; deterministic research seeds describe dreaming as
  metaphor rather than as a real keyword.
- `double-research-loop`: every successful background observation run also
  refreshes the idea graph and writes `lastGraphAt` to observation-loop state.
- `neural-cockpit`: cockpit polls `/api/observation-loop` every minute and
  reloads on `lastGraphAt` change; node hover/select no longer moves nodes;
  stage height is independent of right-panel content.

## Impact

- Affects `src/idea-graph.ts`, `src/observation-loop.ts`, `src/types.ts`, and
  `src/web.ts` plus their test files.
- Bumps `package.json`, `package-lock.json`, `src/version.ts`, and
  `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.6.1`.
- Updates `README.md` and `AGENTS.md` with the v0.6.1 entry.
- No data migration: legacy nodes are filtered on read rather than rewritten.
- No new external service or dependency.
