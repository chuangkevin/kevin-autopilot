## ADDED Requirements

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
