## 1. ConversationMessage 型別與對話串讀寫

- [ ] 1.1 在 `src/types.ts` 新增 `ConversationMessage` interface：`{ id: string; sender: 'ai' | 'kevin'; content: string; createdAt: string }`
- [ ] 1.2 新增 `src/conversation.ts`：實作 `appendConversationMessage(config, msg)`、`listConversationMessages(config, opts?: { since?: string; limit?: number })`，儲存於 `data/conversation.json`，上限 200 條
- [ ] 1.3 寫測試：append 寫入正確、since 篩選正確、超過 200 條截舊訊息

## 2. Patrol function

- [ ] 2.1 新增 `src/patrol.ts`：`runPatrol(config, briefs): Promise<string | null>`，用 `buildPersonaPrefix('patrol', config)` + top-3 briefs + 近 20 條對話歷史組 prompt，呼叫 Gemini，回傳 AI 說的話或 null（空字串或失敗都回 null）
- [ ] 2.2 在 `src/persona.ts` 的 `buildPersonaPrefix` mode union 加上 `'patrol'`
- [ ] 2.3 寫測試：Gemini 回傳非空字串 → 回傳該字串；Gemini 回傳空字串 → 回傳 null；Gemini 失敗 → 回傳 null（不拋例外）

## 3. 觀察循環接 patrol

- [ ] 3.1 在 `src/observation-loop.ts` 的 `runProblemDiscoverySafely` 完成後，呼叫 `runPatrol`；若回傳非 null，呼叫 `appendConversationMessage` 寫入 sender=ai 訊息
- [ ] 3.2 patrol 失敗不中斷觀察循環（catch 後 console.warn 繼續）

## 4. Chat API

- [ ] 4.1 在 `src/web.ts` 新增 `GET /api/conversation`（trusted）：回傳 `{ messages }` 最多 50 條，支援 `?since=` query param
- [ ] 4.2 在 `src/web.ts` 新增 `POST /api/conversation/reply`（trusted）：寫入 kevin 訊息 → 呼叫 Gemini（帶 persona prefix + 近 20 條歷史）→ 寫入 ai 回覆 → 回傳 201 `{ aiMessage }`；Gemini 失敗回 502
- [ ] 4.3 寫測試：GET 回傳訊息陣列、since 篩選、POST 寫入兩條訊息並回傳 aiMessage、untrusted POST 回 403

## 5. Chat UI

- [ ] 5.1 在 `src/web.ts` 的問題 tab 底部加入 chat 區塊 HTML：訊息列表容器、輸入框、送出按鈕
- [ ] 5.2 加入 CSS：AI 訊息左對齊氣泡、Kevin 訊息右對齊氣泡、loading 狀態
- [ ] 5.3 加入 JS：每 5 秒 polling `GET /api/conversation?since=<last>`，append 新訊息；送出後鎖定輸入框顯示「思考中…」，等 POST 回傳後解鎖並顯示 AI 回覆
- [ ] 5.4 build + 所有測試通過後 commit

## 6. 版本更新與部署

- [ ] 6.1 `src/version.ts` 版本號更新至 `0.20.0`
- [ ] 6.2 `AGENTS.md` 記錄 v0.20.0 patrol-chat 功能
- [ ] 6.3 `npm run build && npm test` 全過後 commit + push
