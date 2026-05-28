## Context

Autopilot 已有：
- `buildPersonaPrefix` — 組合 PERSONA.md + mood + preference 的 system context
- `fetchExternalSignals` — 每次觀察循環抓 HN/Reddit
- `getDailyProblemDiscovery` — 把 signals 歸納成 problem briefs
- 觀察循環每 N 分鐘跑一次，結果寫進檔案

現在沒有：訊息從系統主動推給 Kevin 的機制，也沒有 Kevin 可以直接回覆的介面。

## Goals / Non-Goals

**Goals:**
- 觀察循環結束後，AI 判斷「有沒有值得說的」，有就寫一條主動訊息
- Kevin 可以在 UI 回覆，AI 立刻接話
- 對話帶 PERSONA.md + mood + preference context，說話像 Kevin 的分身
- 對話歷史持久化，不因重啟消失

**Non-Goals:**
- WebSocket 或 SSE（polling 足夠，不加複雜度）
- 多用戶對話
- 對話訊息影響 problem discovery 的選題邏輯（兩者獨立）
- 對話訊息影響 deliberation

## Decisions

### 對話串儲存：單一 JSON 陣列檔
`data/conversation.json` 存訊息陣列，上限 200 條（超過截掉最舊的）。
不用多檔案 — 訊息量小，單檔讀寫夠用，跟現有 `preference-cache.json` / `mood-state.json` 同模式。

### Patrol function：`src/patrol.ts`
```
buildPersonaPrefix('patrol', config)
  + 今日 top-3 problem briefs 摘要
  + 近 10 條對話歷史
  → Gemini prompt: "你是 Kevin 的分身。根據今天掃到的訊號，
     有沒有值得主動告訴 Kevin 的事？
     如果有，用一段話說（不超過 120 字）。
     如果沒什麼新的，回傳空字串。"
→ 回傳 string（空 = 不說話）
```

決策依據：
- 用 `buildPersonaPrefix` 確保 patrol 說話風格跟其他 AI call 一致
- 讓 AI 自己決定要不要說（空字串 = 不插話），不用硬規則
- 120 字上限：夠說清楚一件事，不夠寫論文

### 即時回覆：同步 Gemini call
`POST /api/conversation/reply` 收到 Kevin 的訊息後：
1. 寫入 Kevin 的訊息
2. 同步跑 Gemini（帶完整對話歷史 + persona prefix）
3. 寫入 AI 回覆
4. 回傳 AI 回覆

等待時間預期 2-5 秒，前端顯示「思考中...」。

### Chat UI：問題 tab 底部附加，polling 5 秒
- 不新增 tab，附在問題 tab 最下方
- `setInterval` 每 5 秒 GET `/api/conversation?since=<lastTimestamp>`
- 顯示最新 20 條，往上捲可看更多
- 輸入框 + 送出按鈕，按下後鎖定等 AI 回覆

### Context window：近 20 條對話 + top-3 briefs
patrol 和 reply 都用相同的 context 組合：
- `buildPersonaPrefix('patrol', config)` 
- 今日 top-3 problem brief 標題 + tier
- 近 20 條對話訊息

## Risks / Trade-offs

- **Patrol 可能太吵**：每次觀察循環都可能說話。靠 AI 自己判斷「有沒有值得說的」來控制頻率，但初期可能還是太多。可之後加 cooldown（例如 1 小時內不重複同類訊息），但先不做。
- **同步 Gemini call 阻塞 reply**：Kevin 送出回覆後要等 2-5 秒。可接受，前端顯示 loading 狀態。
- **200 條上限截斷歷史**：超過後最舊的訊息消失。對話記憶是滾動視窗，符合預期。
