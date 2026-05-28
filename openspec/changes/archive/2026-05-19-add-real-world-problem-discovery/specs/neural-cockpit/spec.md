## MODIFIED Requirements

### Requirement: Dashboard Primary Surface

Kevin Autopilot SHALL make the dashboard's first screen a daily real-world problem opportunity surface instead of a graph-first neural cockpit.

#### Scenario: Daily problem available

- **WHEN** a `DailyProblemPick` exists
- **THEN** the dashboard first screen SHALL show who is stuck, the workflow, the pain, the workaround, evidence, Kevin fit, the MVP, validation plan, and kill criteria.

#### Scenario: Insufficient evidence

- **WHEN** no acceptable `DailyProblemPick` exists
- **THEN** the dashboard first screen SHALL explain what evidence is missing and how Kevin can provide a signal, instead of rendering speculative graph bubbles as if they were useful.

#### Scenario: User opens graph

- **WHEN** Kevin chooses the graph/exploration tab
- **THEN** the cockpit MAY show relationships among ideas, projects, problem briefs, people groups, workflows, and workarounds, but it SHALL remain secondary to the daily problem card.
