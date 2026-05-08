# Kevin Autopilot

Kevin Autopilot is a planned background agent service that continuously looks
for useful work, thinks with Kevin's decision model, and turns safe findings into
bounded tasks for OpenCode or another coding agent.

The first version is planning-only and does not implement runtime code yet.

## Goal

Build an AI system that can proactively:

1. Notice repeated pain, broken workflows, stale docs, failing checks, and small
   improvement opportunities.
2. Rank work using Kevin's priorities: user experience, stability, and
   verifiability.
3. Decide whether a task can be done automatically, needs Kevin approval, or must
   be blocked.
4. Produce bounded OpenCode prompts for safe implementation.
5. Verify, commit, and push completed low-risk changes when allowed.

## Persona Source

The canonical persona is outside this repo:

`D:\Projects\_HomeProject\homelab-docs\kevin-ai-persona\PERSONA.md`

The service must load that file before making work decisions.

## Initial Scope

Version 0.1 should only think and plan:

1. Scan configured repositories.
2. Collect git status, recent commits, TODO/FIXME notes, docs drift signals, and
   build/test command availability.
3. Generate candidate tasks.
4. Score and classify tasks.
5. Show a daily or on-demand report.
6. Generate OpenCode prompts, but do not automatically run implementation.

Version 0.2 may execute low-risk tasks through OpenCode after v0.1 proves useful.

## Non-Goals For v0.1

1. No autonomous file modification.
2. No deployment.
3. No secret access.
4. No production actions.
5. No data deletion or rebuild.
6. No force push.

## Status

Planning started. See `docs/` for architecture, safety, and OpenCode workflow.
