# Kevin Autopilot Agent Rules

Before making decisions in this repo, read:

1. The resolved `homelab-docs/AGENTS.md` for the current environment.
2. The resolved `homelab-docs/kevin-ai-persona/PERSONA.md` for the current
   environment.

Do not assume one machine-specific HomeProject path. Prefer `OPENCODE_DIRECTORY`
or configured/mounted rule-source paths, then common HomeProject roots only as a
fallback during local development.

Kevin approved the v0.1 Dockerized observer and v0.2 idea-intake prototype work.
Keep these versions read-only: they may observe, classify, report, and store
Autopilot-owned reports/idea records, but they must not modify target repos,
create repos, deploy, commit/push other projects, or perform destructive actions
without a later explicit approval gate.

Safety rules:

1. Do not read or edit secrets, `.env*`, credential JSON, or service-account
   files.
2. Do not implement autonomous destructive actions.
3. Do not deploy.
4. Keep v0.1 read-only unless Kevin explicitly expands scope.
