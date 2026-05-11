# Kevin Autopilot Agent Rules

Before making decisions in this repo, read:

1. The resolved `homelab-docs/AGENTS.md` for the current environment.
2. The resolved `homelab-docs/kevin-ai-persona/PERSONA.md` for the current
   environment.

Do not assume one machine-specific HomeProject path. Prefer `OPENCODE_DIRECTORY`
or configured/mounted rule-source paths, then common HomeProject roots only as a
fallback during local development.

Kevin approved the v0.1 Dockerized observer, v0.2 idea-intake prototype, v0.3
key import / agent handoff metadata, v0.4 kevinhome deployment, v0.5
read-only project handoff plan work, v0.5.3 settings-page DB-backed key
management, v0.5.4 key-manager paste/mobile layout fixes, v0.5.5 GMT+8
display time, v0.5.6 read-only Observation Backlog, v0.5.7 bounded OpenCode
prompts for observation candidates, v0.5.8 dashboard usage guidance / copy
prompt UX, and v0.5.9 Kevin sub-persona main-agent self-Q&A with
Autopilot-owned dashboard supplements.
Keep these versions read-only: they may observe, classify, report, and store
Autopilot-owned reports/idea records/supplements, but they must not modify target
repos, create repos, deploy, commit/push other projects, or perform destructive
actions without a later explicit approval gate.

Safety rules:

1. Do not read or edit secrets, `.env*`, credential JSON, or service-account
   files, except for Autopilot-owned managed key storage under ignored `data/`.
2. Do not implement autonomous destructive actions.
3. Do not deploy.
4. Keep v0.1 read-only unless Kevin explicitly expands scope.
5. Do not implement background execution that edits repos, commits, pushes, or
   deploys until scheduler state, permission gates, interrupt handling, pending
   actions, and health/status surfaces are explicitly designed and approved.
