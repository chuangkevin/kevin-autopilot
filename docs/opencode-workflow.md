# OpenCode Workflow Plan

OpenCode is the first execution backend for Kevin Autopilot.

## v0.1 Behavior

Autopilot only generates prompts. Kevin manually runs or approves them.

Autopilot itself should run in Docker when implemented, but generated OpenCode
prompts must stay environment-aware. They should refer to configured rule-source
names and resolved paths from the current run instead of assuming one machine's
absolute path.

## Prompt Template

```text
請先讀取目前環境解析到的 homelab-docs AGENTS.md，並載入目前環境解析到的
homelab-docs/kevin-ai-persona/PERSONA.md。

如果本次任務指定其他 rule sources，也請先讀取那些來源的入口規則。

任務：<task title>

背景：<why this matters>

限制：
- 不得改使用者流程，除非 Kevin 明確批准。
- 不得刪資料或重建資料。
- 不得動部署、正式環境、金鑰、.env 或 credential。
- 不得大重構。
- 不得改 API contract。
- 不得 force push 或 hard reset。
- 不得假設固定本機路徑；使用本次 prompt 提供的 resolved paths。
- 第一階段只觀察服務，不主動修復或部署。

完成條件：
- 用最小正確修改完成。
- 驗證結果要有證據。
- 若有改檔，回報改了什麼、風險、沒做什麼。
- 可提交且 remote 可用時，commit + push，除非 Kevin 說不要。
```

## Future v0.2 Execution Flow

1. Create an isolated branch or worktree.
2. Generate a bounded OpenCode prompt.
3. Run OpenCode with timeout and tool limits.
4. Verify the result.
5. If review passes, commit and push.
6. Report evidence and links back to Kevin.

## Future Idea Handoff Flow

When Kevin pastes a raw idea, Autopilot should generate an OpenCode prompt only
after it has captured:

1. Original idea text.
2. Intended user or workflow pain.
3. Repo decision: existing repo or new repo.
4. Deployment target recommendation.
5. Architecture and stack decision.
6. OpenSpec change ID or proposal path.
7. Approval state for repo creation, implementation, deployment, and commit/push.
