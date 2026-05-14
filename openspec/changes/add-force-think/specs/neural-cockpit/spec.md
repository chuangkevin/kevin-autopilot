## ADDED Requirements

### Requirement: Force-Think Button In 分身 Tab
Kevin Autopilot SHALL render a "⚡ 強制思考" button in the 分身 tab that calls `POST /api/deliberation` and shows live status feedback while the deliberation is in progress.

#### Scenario: Button visible in 分身 tab
- **WHEN** Kevin opens the 分身 tab
- **THEN** a "⚡ 強制思考" button SHALL be visible, styled with the existing magenta/pink palette to distinguish it from the regular observe-and-reflect flow.

#### Scenario: Button triggers deliberation
- **WHEN** Kevin taps "⚡ 強制思考" from a trusted-settings source
- **THEN** the cockpit SHALL `POST /api/deliberation`, disable the button, and show "🔄 辯論進行中…" status text until the deliberation completes.

#### Scenario: Button disabled during run
- **WHEN** a deliberation is already running
- **THEN** the button SHALL be disabled and the status SHALL read "🔄 辯論進行中…" so Kevin cannot double-trigger.

#### Scenario: Non-trusted source sees button but gets 403
- **WHEN** Kevin taps the button from a non-trusted network origin
- **THEN** the button SHALL re-enable and the status SHALL display a short error message derived from the 403 response.

### Requirement: Deliberation Result Card In 分身 Tab
Kevin Autopilot SHALL render a deliberation-result card below the force-think button showing the latest completed deliberation record — personas deployed, per-persona key insights from round 0, synthesis summary, blind spots, and count of seeds injected.

#### Scenario: No deliberation yet
- **WHEN** the 分身 tab renders and no deliberation record exists
- **THEN** the card SHALL show "尚未辯論" in muted text with no further detail.

#### Scenario: Latest record rendered
- **WHEN** a deliberation record exists
- **THEN** the card SHALL show: persona chips (name only), per-persona top-2 key insights from round 0, the synthesis summary text, up to 3 blind-spots found, and "注入 N 個想法 → idea graph".

#### Scenario: Client polls while running
- **WHEN** the deliberation status is `running`
- **THEN** the cockpit client SHALL poll `GET /api/deliberation/latest` every 3 seconds and update the status text; once `status` returns `done` the page SHALL reload to show the fresh record.
