## Context

Kevin Autopilot's observation loop runs on a fixed schedule (default 5 min). The loop does: `observe()` → merge backlog → build idea graph → `reflect()`. The reflection module already calls Gemini via `GeminiClient` / `KeyPool` from `@kevinsisi/ai-core`. There is no way to trigger a cycle on demand, and the single-model reflection produces one perspective with no adversarial challenge.

The deliberation engine adds a second AI workload: it reuses the same raw observation data but fans it out to N AI personas that debate in rounds, then synthesises findings into idea seeds.

## Goals / Non-Goals

**Goals:**
- `forceRun()` on `ObservationLoop` triggers a full cycle regardless of `backgroundObservation.enabled`
- Multi-agent deliberation: role picker → independent analysis → 2 debate rounds → synthesis
- Deliberation result card rendered in 分身 tab; latest record exposed at `GET /api/deliberation/latest`
- High-quality seeds from synthesis injected into idea graph via existing `createAiIdeaFromSeed()`
- `POST /api/deliberation` starts a deliberation; trusted-settings gated

**Non-Goals:**
- Streaming or SSE for live round-by-round updates (client polls every 3 s)
- More than 4 personas or more than 2 debate rounds (cost guard)
- Replacing the regular reflection cycle; deliberation is on-demand only
- Autonomous mutations (read-only safety boundary unchanged)

## Decisions

### D1: One `observe()` call, N persona AI calls

**Chosen**: Collect raw data once (git, services, supplements) then fan out N AI calls each with a different system prompt persona.

**Alternative rejected**: Run full `observe()` per persona — multiplies git I/O and is 3–4× slower with no benefit; raw data is the same for all personas.

### D2: `forceRun()` bypasses `enabled` guard, not key guard

**Chosen**: `forceRun()` skips `if (!this.state.enabled) return` but still returns early if no AI keys are configured.

**Rationale**: The point of force-run is to fire even in manual mode. Skipping the key guard would produce confusing silent no-ops when AI is unconfigured.

### D3: Async POST + polling

**Chosen**: `POST /api/deliberation` starts a background deliberation, returns `202 { status: 'started' }` immediately. Client polls `GET /api/deliberation/latest` every 3 s.

**Alternative rejected**: Blocking POST — deliberation takes 20–60 s; holding an HTTP connection that long is fragile on mobile.

### D4: In-memory running flag + file persistence

**Chosen**: `ObservationLoop` (or a module-level singleton) holds a `deliberationInFlight` boolean. Each completed deliberation is written to `data/deliberations/<id>.json`. `GET /api/deliberation/latest` reads the most recent file. Maximum 10 records kept (oldest pruned on write).

**Rationale**: Keeps the same pattern as observation reports; no new DB needed; bounded disk use.

### D5: Trusted-settings gate on POST /api/deliberation

**Chosen**: Same `isTrustedSettingsRequest` guard used by Gemini key import and runtime overrides.

**Rationale**: Deliberation triggers real Gemini API calls (cost + quota). Restricting to loopback / LAN / Docker / Tailscale mirrors the existing trusted-settings policy.

### D6: Reuse GeminiClient / KeyPool

Deliberation calls the same `KeyPool` + `GeminiClient` from `reflection.ts`. No new AI dependency. Persona prompts are injected as `systemInstruction` overrides on each call.

## Risks / Trade-offs

- **Token cost per deliberation**: 4 personas × 3 rounds (round 0 + 2 debate) × ~700 tokens + synthesis ≈ 10–15 k tokens per trigger. → Mitigation: cap at 4 personas, 2 debate rounds; surface token usage in the record.
- **Long-running under mobile sleep**: Android may kill the polling interval if the screen locks mid-deliberation. → Mitigation: `GET /api/deliberation/latest` always returns the in-progress or completed state; a page reload recovers.
- **Key pool exhaustion**: Deliberation fires N+1 concurrent AI calls. → Mitigation: `KeyPool` already handles retries/rotation; deliberation phases are sequential (not all-at-once globally), so peak concurrency = N persona calls in phase 3.
- **Deliberation while loop is running**: `forceRun()` can coexist with a scheduled cycle. Raw data is collected independently. → Acceptable; treat them as independent workloads.
