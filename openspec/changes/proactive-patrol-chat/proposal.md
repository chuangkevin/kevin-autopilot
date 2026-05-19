## Why

問題 tab 現在是被動的 — Kevin 得主動去看卡片、手動觸發重新整理。系統掃到東西但不會主動告訴你，你也沒辦法跟它說話。

目標是讓 Autopilot 變成真正的思考夥伴：它在後台持續巡邏所有 signals，發現值得說的事情就主動開口；Kevin 回覆後它立刻接話，整個過程像跟一個已經想過很多的人在對話，不是在查系統。

## What Changes

- 觀察循環每次跑完，跑一個 patrol Gemini call：用 PERSONA.md + 當次 signals + 近期對話歷史判斷「有沒有值得主動說的」，有的話寫一條 AI 訊息進對話串
- 新增對話串資料結構（`data/conversation/` JSON 檔案），記每一條訊息（sender、timestamp、content、context snapshot）
- 新增 chat API：`GET /api/conversation` 拿近期訊息、`POST /api/conversation/reply` Kevin 回覆後立刻跑 Gemini 接話
- 問題 tab 加入對話 UI，polling 顯示新訊息，Kevin 可打字回覆

## Capabilities

### New Capabilities
- `patrol-chat`: 背景巡邏後主動生成訊息、Kevin 可回覆、AI 立即接話的對話串系統

### Modified Capabilities
- `problem-discovery`: 觀察循環在 problem discovery 完成後接 patrol call，不改變原有 discovery 邏輯

## Impact

- `src/patrol.ts` 新增：patrol Gemini call 邏輯
- `src/conversation.ts` 新增：對話串讀寫
- `src/observation-loop.ts` 修改：每次循環結束後呼叫 patrol
- `src/web.ts` 修改：新增 `/api/conversation` 端點 + chat UI
- `src/types.ts` 修改：新增 `ConversationMessage` 型別
- 不改變現有 problem discovery、deliberation、boost 任何行為
