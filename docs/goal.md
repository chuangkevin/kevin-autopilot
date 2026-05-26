📄 1. 專案總目標

建立一個 AI 系統，用來：

持續追蹤你正在做的所有事情（threads），並把「同時做多件事的代價」完整可視化，讓你自行做決策。

❌ 系統不做：
不推薦你做什麼
不排序最優解
不說「應該做這個」
不替你收斂人生方向
✔ 系統只做：
追蹤你在做什麼（threads）
計算每件事的成本
顯示代價與衝突
顯示如果選 A，會失去什麼
顯示如果同時做多件事會怎樣
🧠 2. 核心概念
Thread = 一條「人生/專案平行線」

例如：

Infra system
Side project A
Side project B
Learning Rust
Exploring ideas
World signals research
🧩 3. 系統架構
                ┌──────────────┐
                │ Data Sources │
                └──────┬───────┘
                       ↓
          ┌────────────────────────┐
          │ Event Normalizer (AI)  │
          └────────┬───────────────┘
                   ↓
          ┌────────────────────────┐
          │ Memory / Thread Graph  │
          └────────┬───────────────┘
                   ↓
          ┌────────────────────────┐
          │ Cost Engine (AI + rule)│
          └────────┬───────────────┘
                   ↓
          ┌────────────────────────┐
          │ UI Renderer            │
          └────────┬───────────────┘
                   ↓
              User View
🧠 4. AI 使用方式（嚴格分工）
4.1 Event Normalizer

輸入：

logs
reddit posts
commits
notes

輸出：

{
  "type": "event_type",
  "entities": [],
  "summary": "",
  "severity": "low/med/high"
}

👉 不推論、不建議

4.2 Memory Layer AI

功能：

clustering events
merging patterns
building relationships

輸出：

Pattern detected:
Backup jobs correlate with latency spikes

👉 不決策

4.3 Cost Engine AI（核心）

輸出每個 thread：

{
  "time_cost": 0.8,
  "cognitive_load": 0.7,
  "execution_risk": 0.5,
  "opportunity_cost": 0.6,
  "context_switch_penalty": 0.4
}

👉 不推薦任何東西

4.4 Optional Decision Layer（可關）
Suggestion (optional):
Focus on Side Project B

Reason:
Highest leverage vs cost

Confidence: 0.61

👉 完全非核心

🧠 5. Thread Data Model
{
  "id": "infra-system",
  "name": "Infra System",
  "status": "active",
  "momentum": "stable",
  "dependencies": ["redis", "deploy pipeline"],
  "last_update": "2026-05-26"
}
📊 6. Cost Model（核心）
time_cost
cognitive_load
execution_risk
opportunity_cost
context_switch_penalty
🧩 7. UI 設計（最重要）
🟦 7.1 主畫面（Thread Overview）
THREAD OVERVIEW

Infra System        COST: HIGH
Side Project A      COST: LOW
Side Project B      COST: MED
Learning Rust       COST: LOW
World Exploration   COST: MED
Random Ideas        COST: HIGH

👉 不排名、不推薦

🟨 7.2 Thread Detail（核心 UI）
THREAD: Infra System

COST BREAKDOWN
Time Cost: ████████ 80%
Cognitive: ████████ 80%
Risk: ██████ 60%
Opportunity Loss: █████ 50%

DEPENDENCIES
- Redis
- Deployment pipeline

CONSEQUENCES

IF you continue:
→ Infra stability improves
→ Side projects slow down

IF you stop:
→ Infra risk increases
→ Cognitive load decreases
🟥 7.3 Counterfactual View（殺手功能）
IF ONLY Infra:
- Stability ↑↑
- Creativity ↓↓

IF ONLY Side Project A:
- Revenue potential ↑
- Infra risk ↑↑

IF SPLIT ATTENTION:
- Everything medium quality
- Nothing completes
🟩 7.4 Optional Decision Block
AI Suggestion (optional):
→ Focus on Side Project B

Confidence: 0.58

👉 可關閉

⚙️ 8. 系統運作流程
1. Collect events continuously
2. Normalize into structured events
3. Update thread graph
4. AI computes cost per thread
5. Generate counterfactuals
6. Render UI
7. (optional) generate suggestion
⏱ 9. 排程系統
Event ingestion：continuous
Memory update：每 1 小時
Cost computation：每 6 小時
Daily report：每天一次
🧪 10. MVP 開發流程（實作順序）
Phase 1（最小可用）
做：
Thread model
Event ingestion（手動 + API）
Cost Engine（AI prompt）
Basic UI（list + detail）

👉 沒有 suggestion

Phase 2
Counterfactual view
memory graph
dependency tracking
Phase 3
optional decision layer
daily report
backlog integration
Phase 4（可選）
external signal scraping
Reddit / HN ingestion
idea pipeline
🧠 11. 成功標準

系統成功不是：

更多 idea
更好的推薦

而是：

✔ 你開始「少做事但更清楚」
✔ 每個選擇的代價變得不可忽視
✔ 多線並行會變得痛
✔ 注意力開始自然收斂

🧨 12. 系統本質

一個不幫你做決定，但讓你無法忽略代價的持續認知系統。

🧠 最後一句話（很重要）

你做的不是：

AI productivity tool

你做的是：

一個讓「多工幻想破裂」的系統