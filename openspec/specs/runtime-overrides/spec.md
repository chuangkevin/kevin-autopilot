# runtime-overrides Specification

## Purpose

A whitelist-gated runtime override layer for the World Problem Radar config: a `${dataDir}/runtime-overrides.json` file written through a typed API and the settings page, merged non-destructively over the file config at the start of each decision so changes take effect without a container restart.

The whitelist is intentionally tiny in v1.0.0 (only the radar scan cadence). Adding a new override field is a deliberate code change to `RUNTIME_OVERRIDE_SCHEMA`, not a config-time choice.

## Requirements

### Requirement: Whitelisted Runtime Override Surface

World Problem Radar SHALL maintain a hard-coded whitelist `RUNTIME_OVERRIDE_SCHEMA` of dot-keyed config fields that may be overridden at runtime, and SHALL reject every override that targets a field not on the whitelist.

#### Scenario: Whitelisted field flips effective config

- **WHEN** `${dataDir}/runtime-overrides.json` sets a whitelisted field (e.g. `radarScan.intervalMs`) to a valid value
- **THEN** subsequent reads via `getEffectiveConfig` SHALL return the override value for that field, while every other field SHALL match the file config.

#### Scenario: Unknown key is rejected on write

- **WHEN** any caller sends a `POST /api/runtime-overrides` body containing a dot-key not present in `RUNTIME_OVERRIDE_SCHEMA`
- **THEN** the server SHALL respond 400 with a `RuntimeOverrideError` message naming the rejected key, SHALL NOT write the file, and the existing overrides SHALL remain unchanged.

#### Scenario: Type mismatch is rejected on write

- **WHEN** a body sets a boolean field to a non-boolean, or an integer field to a non-integer or out-of-range integer
- **THEN** the server SHALL respond 400 with a typed error and SHALL NOT persist any of the submitted overrides.

### Requirement: Current Whitelist (v1.0.0)

The whitelist SHALL contain exactly the radar scan controls:

- `radarScan.enabled` — boolean toggle for background scanning.
- `radarScan.intervalMs` — integer milliseconds in the inclusive range `[60_000, 86_400_000]` (one minute to one day).

#### Scenario: Interval is bounded

- **WHEN** a caller submits `radarScan.intervalMs = 30_000` or `radarScan.intervalMs = 999_999_999`
- **THEN** the server SHALL respond 400 with a range message and SHALL NOT persist the value.

### Requirement: File-Backed Persistence

Overrides SHALL be persisted as JSON to `${dataDir}/runtime-overrides.json`. The file is the single source of truth; there is no in-memory layer that diverges from disk.

#### Scenario: Missing file means no overrides

- **WHEN** `runtime-overrides.json` is absent or unreadable
- **THEN** `loadRuntimeOverrides` SHALL return `{}` and the effective config SHALL equal the file config.

#### Scenario: Save normalizes to the nested shape

- **WHEN** `saveRuntimeOverrides` accepts dot-keyed input (e.g. `{"radarScan.intervalMs": 3600000}`)
- **THEN** it SHALL persist the nested shape `{"radarScan": {"intervalMs": 3600000}}` so `applyRuntimeOverrides` can merge by top-level section.

### Requirement: Effective Config Per Scan

World Problem Radar SHALL read the effective config (file config merged with current overrides) at the start of every scan and at process start so cadence changes take effect on the next scan boundary without a restart.

#### Scenario: Disabled scan respects the toggle

- **WHEN** `radarScan.enabled = false` is in the overrides
- **THEN** subsequent scans SHALL still respect the override path through `getEffectiveConfig`. (Note: v1.0.0 currently runs scans unconditionally on the interval; toggle wiring is implemented in `applyRuntimeOverrides` but the scan caller does not branch on it yet — see HANDOFF.md "known gaps.")

### Requirement: HTTP API Surface

The radar SHALL expose `GET /api/runtime-overrides` (returns current overrides plus schema) and `POST /api/runtime-overrides` (write, returns the persisted overrides).

#### Scenario: GET returns overrides plus schema

- **WHEN** a client issues `GET /api/runtime-overrides`
- **THEN** the response SHALL be 200 with `{ overrides, schema }` where `schema` is `RUNTIME_OVERRIDE_SCHEMA` (type/min/max/label/description per field).

#### Scenario: POST is open in v1.0.0

- **WHEN** any reachable client posts to `/api/runtime-overrides`
- **THEN** the server SHALL accept the request without trust-source gating. (The settings page is intended for Tailscale/LAN-only exposure; tightening to `isTrustedSettingsRequest` is tracked in HANDOFF.md "known gaps.")
