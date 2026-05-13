## ADDED Requirements

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
