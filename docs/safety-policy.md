# Safety Policy

## Default Mode

v0.1 is read-only planning mode. It may scan, classify, and report. It must not
modify files, commit, push, deploy, or run destructive commands.

v0.5.9 remains read-only even though the dashboard now shows a Kevin sub-persona
main agent and accepts supplements. Supplements are written only to Autopilot's
own data directory and may influence the next recommendation, but they do not
grant permission to mutate target repositories or services.

Docker deployment does not expand permissions. Mounted repositories and rule
sources should be read-only by default. The only writable location in v0.1 should
be Autopilot's own data volume for SQLite state and generated reports.

## Rule Source Safety

The assistant may load `homelab-docs` and user-selected rule sources from
configured paths or mounts. It must record which sources affected a decision so
reports can be audited across environments. It must not assume one local path is
canonical.

## Allowed Without Approval In Future Automation

Only after v0.1 is validated, future versions may auto-run low-risk tasks:

1. Documentation typo fixes.
2. Documentation/behavior mismatch proposals or small fixes.
3. Small tests or verification additions.
4. Small refactors that preserve behavior.
5. Minimal prototype branches.

## Always Requires Kevin Approval

1. User-flow changes.
2. Data deletion or rebuild.
3. Deployment or production changes.
4. Secrets, keys, service-account files, or `.env*` edits.
5. Large refactors.
6. External service or cost additions.
7. API contract changes.
8. Existing user habit changes.

9. Adding a new rule source that can change action permissions.
10. Enabling a new service health check that reaches a production endpoint.
11. Creating a new repository.
12. Choosing or changing a deployment target.
13. Starting implementation from a raw idea.
14. Creating or modifying OpenSpec for a new product direction.

## Idea Handoff Safety

Idea handoff mode must default to planning. A raw idea from Kevin can trigger
analysis, clarification, architecture drafting, and OpenSpec proposal, but it
must not create repos, write product code, deploy, or commit until the approval
state for that step is explicit and recorded.

AI thinking via `@kevinsisi/ai-core` is advisory in v0.2. If AI fails, times out,
or returns invalid JSON, the raw idea must still be preserved and classified with
the deterministic fallback. The UI/report must show whether the result came from
ai-core or fallback.

## Always Forbidden Unless Explicitly Requested

1. Force push.
2. Hard reset.
3. Broad cleanup or recursive deletion.
4. Reading or printing secrets.
5. Silent production changes.

## Background Execution Boundary

Background observation and report generation may run in read-only mode. Any
background execution that edits target repos, commits, pushes, deploys, changes
service state, or performs destructive work requires a later explicit approval
gate and a runtime design with persisted scheduler state, permission checks,
interrupt classification, pending action records, and health/status reporting.

## Verification Standard

Every proposed or completed task must include:

1. What was inspected.
2. Why the task matters.
3. Risk level.
4. Verification plan or evidence.
5. What was not done.

For service observation reports, also include source provenance: which docs,
repos, configured services, and allowed endpoints were inspected.
