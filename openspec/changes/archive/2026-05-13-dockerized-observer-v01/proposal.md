# Dockerized Observer v0.1

## Problem

Kevin Autopilot must run in different HomeProject environments without assuming
one local filesystem layout. It must still apply Kevin's persona and the selected
rule sources while safely observing services before proposing work.

## Goal

Define v0.1 as a Dockerized, read-only observer that resolves rule sources from
configuration, loads Kevin's persona, observes all configured services, and
produces auditable Traditional Chinese reports and bounded OpenCode prompts.

The initial deployment target is `kevinhome`; portability is preserved by using
container paths and runtime config instead of application-level host paths.

## Scope

1. Docker runtime shape and mount expectations.
2. Config-driven rule-source resolution for `homelab-docs` and optional sources.
3. Persona loading that is stable across environments.
4. Read-only service observation as the first phase.
5. Safety boundaries for secrets, production endpoints, and destructive actions.

## Non-Goals

1. No runtime product code in this planning step.
2. No autonomous implementation, deployment, commit, or push in v0.1.
3. No secret scanning or container environment inspection.
4. No production mutation or remediation.
5. No idea-to-implementation automation in v0.1.

## Future Direction

After the observer proves useful, Autopilot should support idea handoff mode:
Kevin can paste raw thoughts and Autopilot turns them into repo, deployment,
architecture, OpenSpec, implementation, testing, and release workflows with
explicit approval gates.

## Open Questions

1. Which host should run the first Docker deployment?
2. Which service health endpoints are allowed in the initial observation config?
3. Which additional rule sources should Kevin be able to select besides
   `homelab-docs`?
