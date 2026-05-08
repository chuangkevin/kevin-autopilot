# OpenCode Workflow Plan

OpenCode is the first execution backend for Kevin Autopilot.

## v0.1 Behavior

Autopilot only generates prompts. Kevin manually runs or approves them.

## Prompt Template

```text
請先讀取 D:\Projects\_HomeProject\homelab-docs\AGENTS.md，並載入
D:\Projects\_HomeProject\homelab-docs\kevin-ai-persona\PERSONA.md。

任務：<task title>

背景：<why this matters>

限制：
- 不得改使用者流程，除非 Kevin 明確批准。
- 不得刪資料或重建資料。
- 不得動部署、正式環境、金鑰、.env 或 credential。
- 不得大重構。
- 不得改 API contract。
- 不得 force push 或 hard reset。

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
