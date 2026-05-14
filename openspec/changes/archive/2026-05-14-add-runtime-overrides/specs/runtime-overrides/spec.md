## ADDED Requirements

### Requirement: Whitelisted Runtime Override Surface
Kevin Autopilot SHALL maintain a hard-coded whitelist of config fields that may be overridden at runtime, and SHALL reject every override that targets a field not on the whitelist.

#### Scenario: Whitelisted field flips effective config
- **WHEN** `data/runtime-overrides.json` sets a whitelisted field (e.g. `aiReflection.enabled`) to a valid value
- **THEN** subsequent reads via `getEffectiveConfig` SHALL return the override value for that field, while every other field SHALL match the file config.

#### Scenario: Non-whitelisted field is rejected on write
- **WHEN** any caller sends a `PUT /api/runtime-overrides` body containing a key not in the whitelist (e.g. `repositories`, `ai.model`, `dataDir`, `services`)
- **THEN** Kevin Autopilot SHALL respond 400 with a message naming the rejected key, SHALL NOT write the file, and the existing overrides SHALL remain unchanged.

#### Scenario: Hand-edited overrides contain invalid types
- **WHEN** `data/runtime-overrides.json` exists on disk with a field whose type or range fails validation (e.g. `maxPendingAiIdeas` set to a string)
- **THEN** `loadRuntimeOverrides` SHALL drop that single field, keep the remaining valid fields, and Kevin Autopilot SHALL behave as if only the valid overrides were set.

### Requirement: Effective Config Is Read Per Decision
Kevin Autopilot SHALL read the effective config (file config merged with current runtime overrides) at the start of every observation cycle and at the start of every request handler whose behaviour depends on an overridable field, so a runtime override takes effect without restarting the container.

#### Scenario: Observation loop picks up `aiReflection.enabled = true`
- **WHEN** `aiReflection.enabled` is flipped from false to true via the settings API while the loop is idle
- **THEN** the next observation cycle SHALL load the override, treat reflection as enabled, and (if conditions allow) call the AI reflection module without a container restart.

#### Scenario: Observation loop picks up `backgroundObservation.enabled = false`
- **WHEN** `backgroundObservation.enabled` is flipped from true to false via the settings API
- **THEN** the in-flight cycle (if any) SHALL finish normally, no new cycle SHALL be scheduled after the current one, and the cockpit `ObservationLoopState.enabled` SHALL reflect the override on the next status read.

#### Scenario: Numeric override clamps
- **WHEN** `aiReflection.maxPendingAiIdeas` override is set within its allowed range (1..50)
- **THEN** the reflection prompt's `maxNewSeeds = max(0, cap - pending)` calculation SHALL use the override value, and the cockpit reflection status line SHALL render the override value as the `cap`.

### Requirement: Trusted-Settings-Gated Override API
Kevin Autopilot SHALL expose `GET /api/runtime-overrides` and `PUT /api/runtime-overrides` only to trusted-settings sources (loopback, private LAN, Docker, or Tailscale), reusing `isTrustedSettingsRequest`.

#### Scenario: Read current overrides plus schema
- **WHEN** Kevin issues `GET /api/runtime-overrides` from a trusted source
- **THEN** Kevin Autopilot SHALL return JSON containing `overrides` (the current effective overrides) and `schema` (the whitelist with type and range hints) so the settings page can render controls.

#### Scenario: Partial PUT merges overrides
- **WHEN** Kevin issues `PUT /api/runtime-overrides` with a body containing a subset of whitelisted fields
- **THEN** Kevin Autopilot SHALL merge the body into the existing overrides (fields not present in the body keep their current value), validate every present field, persist the result, and respond 200 with the new overrides.

#### Scenario: Reset a field to default
- **WHEN** Kevin issues `PUT /api/runtime-overrides` with a body where a whitelisted field is `null`
- **THEN** Kevin Autopilot SHALL remove that field from the overrides file and the field's effective value SHALL revert to the file-config value.

#### Scenario: Untrusted source is blocked
- **WHEN** any non-trusted source attempts `GET` or `PUT /api/runtime-overrides`
- **THEN** Kevin Autopilot SHALL respond 403 and SHALL NOT read or write the overrides file.
