## ADDED Requirements

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
