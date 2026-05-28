## ADDED Requirements

### Requirement: patrol generates proactive message after observation loop
每次觀察循環成功完成後，系統跑一次 patrol call 判斷是否主動說話。

#### Scenario: patrol finds something notable
- **WHEN** 觀察循環完成，patrol Gemini call 回傳非空字串
- **THEN** 將一條 sender=ai 的訊息寫入對話串，content 為 patrol 回傳的字串

#### Scenario: patrol finds nothing notable
- **WHEN** 觀察循環完成，patrol Gemini call 回傳空字串或 Gemini 失敗
- **THEN** 不寫任何訊息，對話串不變

### Requirement: Kevin can reply and get immediate AI response
Kevin 透過 POST /api/conversation/reply 送出訊息後立刻收到 AI 回覆。

#### Scenario: Kevin sends a message
- **WHEN** Kevin POST { message: string } 到 /api/conversation/reply（trusted request）
- **THEN** 寫入 sender=kevin 的訊息，同步呼叫 Gemini，寫入 sender=ai 的回覆，回傳 201 { aiMessage: ConversationMessage }

#### Scenario: Gemini call fails on reply
- **WHEN** Kevin 送出訊息但 Gemini call 失敗或 timeout
- **THEN** Kevin 的訊息仍寫入；回傳 502，不寫入 AI 訊息

#### Scenario: untrusted reply attempt
- **WHEN** POST /api/conversation/reply 來自非 trusted source
- **THEN** 回傳 403，不寫入任何訊息

### Requirement: conversation history is accessible via GET
UI 可以拿到近期對話訊息做 polling。

#### Scenario: get recent messages
- **WHEN** GET /api/conversation（trusted request）
- **THEN** 回傳 200 { messages: ConversationMessage[] }，最多 50 條最新訊息

#### Scenario: get messages since timestamp
- **WHEN** GET /api/conversation?since=<ISO timestamp>
- **THEN** 只回傳 createdAt > since 的訊息

### Requirement: conversation persists across restarts
對話串寫進 data/conversation.json，重啟後不丟失，上限 200 條。

#### Scenario: message count exceeds limit
- **WHEN** 寫入新訊息後總數超過 200 條
- **THEN** 截掉最舊的訊息，維持最多 200 條
