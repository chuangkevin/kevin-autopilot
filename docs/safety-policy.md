# Safety Policy

## Default Mode

v0.1 is read-only planning mode. It may scan, classify, and report. It must not
modify files, commit, push, deploy, or run destructive commands.

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

## Always Forbidden Unless Explicitly Requested

1. Force push.
2. Hard reset.
3. Broad cleanup or recursive deletion.
4. Reading or printing secrets.
5. Silent production changes.

## Verification Standard

Every proposed or completed task must include:

1. What was inspected.
2. Why the task matters.
3. Risk level.
4. Verification plan or evidence.
5. What was not done.
