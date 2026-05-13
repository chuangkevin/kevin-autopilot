# Durable Backlog Capability

## Purpose

Kevin Autopilot SHALL maintain a persistent, deduplicated, Kevin-owned
backlog of observation candidates so the same underlying signal accumulates
recurrence evidence across observation cycles rather than being presented
as a new finding each time.

## Requirements

### Requirement: Deterministic identity across cycles

Each backlog item SHALL have a deterministic id derived from `(repo, kind,
kind-specific identity key)` so the same underlying signal upserts rather
than duplicates when the observation loop runs again.

#### Scenario: Same candidate upserts across cycles
- **GIVEN** a candidate with `kind='suspected_bug'`, `repo='kevin-autopilot'`, and identity key `(file_path, signal_subtype)`
- **WHEN** the same candidate appears in two consecutive observation cycles
- **THEN** the backlog has exactly one row for that signal with `seen_count = 2`

#### Scenario: Different signals in the same repo do not collide
- **GIVEN** two candidates in the same repo with the same `kind` but different identity keys
- **WHEN** both appear in one cycle
- **THEN** the backlog has two separate rows with different ids

### Requirement: Status lifecycle

A backlog item SHALL transition only through `active`, `snoozed`,
`dismissed`, and `resolved` statuses, with `dismissed` as a permanent
terminal state from Kevin's side.

#### Scenario: Snooze expires read-side
- **GIVEN** a backlog item with `status='snoozed'` and `snoozed_until=2026-05-15`
- **WHEN** the backlog is queried on `2026-05-16`
- **THEN** the item is returned in the `active` filter

#### Scenario: Dismiss is final without explicit un-dismiss
- **GIVEN** a backlog item with `status='dismissed'`
- **WHEN** a later observation cycle re-detects the same signal
- **THEN** the item remains `dismissed` and `seen_count` is not incremented

#### Scenario: Resolved revives on recurrence
- **GIVEN** a backlog item with `status='resolved'`
- **WHEN** a later observation cycle re-detects the same signal
- **THEN** the item flips back to `active`, `seen_count` increments, and `miss_count` resets to 0

#### Scenario: Recurrence during active snooze keeps the snooze
- **GIVEN** a backlog item with `status='snoozed'` and `snoozed_until > now`
- **WHEN** an observation cycle re-detects the same signal
- **THEN** `seen_count` still increments and `miss_count` resets, but `status` remains `snoozed` and the item does not appear on the cockpit graph until `snoozed_until` passes

### Requirement: Strength derived from recurrence

Each backlog row SHALL carry a `strength` of `weak`, `medium`, or `strong`
that is recomputed each cycle from `seen_count` and `miss_count`.

#### Scenario: Recurrence raises strength
- **GIVEN** a backlog item recurring with `miss_count=0`
- **WHEN** `seen_count` reaches 2
- **THEN** `strength` becomes `medium`; at `seen_count >= 5` it becomes `strong`

#### Scenario: Absence lowers strength
- **GIVEN** a backlog item with `strength='medium'`
- **WHEN** `miss_count` reaches 3
- **THEN** `strength` is one level lower the next cycle

#### Scenario: Auto-stale dismisses long-absent items
- **GIVEN** an `active` backlog item
- **WHEN** `miss_count` reaches 6
- **THEN** `status` automatically transitions to `dismissed`

### Requirement: Kevin-facing actions are pure metadata

Kevin SHALL be able to `dismiss`, `snooze(days ∈ {1, 7, 30})`, and `resolve`
a backlog item. These actions SHALL only mutate `data/autopilot.db` and
SHALL NOT touch any target repository, deploy artefact, or external system.

#### Scenario: Snooze accepts only allowed durations
- **WHEN** a snooze request body has `days` outside `{1, 7, 30}`
- **THEN** the API returns HTTP 400 and the row is not changed

#### Scenario: Action on unknown id
- **WHEN** a dismiss / snooze / resolve request targets an id with no matching row
- **THEN** the API returns HTTP 404 and no row is mutated

### Requirement: Cockpit graph reflects backlog state

Cockpit SIGNAL and RESEARCH graph nodes SHALL be derived from the durable
backlog, and node visuals SHALL reflect the row's `strength`.

#### Scenario: Snoozed and dismissed items leave the graph
- **GIVEN** a backlog row with `status='snoozed'` and `snoozed_until > now` (or `status='dismissed'` / `'resolved'`)
- **WHEN** the cockpit reads the idea graph
- **THEN** that row does not produce a graph node

#### Scenario: Strength changes node confidence
- **GIVEN** a backlog row whose `strength` rises from `weak` to `strong`
- **WHEN** the cockpit refreshes the graph
- **THEN** the corresponding node's `confidence` matches the new strength and the cockpit CSS reads that confidence to render the visual change

### Requirement: Backlog runs read-only over target repositories

The backlog merge and the action APIs SHALL preserve the existing
Autopilot read-only boundary. No target-repo write, commit, push, deploy,
or unmanaged-secret read SHALL be introduced by this capability.

#### Scenario: Backlog merge writes only Autopilot-owned data
- **WHEN** an observation cycle merges candidates into the backlog
- **THEN** the only filesystem writes are to `data/autopilot.db` and the existing Autopilot-owned report / graph files
