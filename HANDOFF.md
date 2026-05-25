# Kevin Autopilot — 交接文件

> 版本：v0.20.0 · 更新日期：2026-05-25 · commit `05d2a87`

---

## 1. 是什麼

Kevin 的個人 AI 副駕駛，跑在家裡伺服器上。核心功能：

| 功能 | 說明 |
|---|---|
| **問題發現（Problem Tab）** | 從 HN / Reddit / 手動貼文 抓訊號，AI 分析成「問題簡報卡」，帶評分、人群、MVP 方向 |
| **多角色辯論（Per-Card Deliberation）** | 每張問題卡滑入時觸發 4 AI 角色 × 2 輪辯論，結果快取到 `data/problem-deliberations/` |
| **分身焦點（Brain Tab）** | AI 反思圖譜、多輪辯論、想法注入 |
| **Idea 神經網路（Graph Tab）** | 用 Cytoscape.js 視覺化想法節點與關聯 |
| **Backlog** | 專案任務追蹤，帶優先度、snooze、resolve |
| **Patrol Chat** | 分身主動 push 今日頭號問題，可對話追問 |
| **Settings** | 設定 OpenCode / Gemini AI 金鑰、多 server 端點、模型選擇 |

---

## 2. 技術架構

```
TypeScript (strict) + Node.js 22 (ESM)
No external frontend framework — 全部 server-side render 到 HTML string
SQLite (Node.js built-in) for backlog DB
Cytoscape.js (client-side graph)
AI: Gemini (key pool) + OpenCode (remote session)
```

### 主要原始檔

| 檔案 | 職責 |
|---|---|
| `src/web.ts` | HTTP server + 所有路由 + 全部 HTML/CSS/JS render |
| `src/problem-discovery.ts` | 訊號 upsert、brief building、評分、pruning |
| `src/external-sources.ts` | HN Algolia API + Reddit JSON API 抓取 |
| `src/problem-deliberation.ts` | 每張卡 4 角色辯論，快取到 JSON |
| `src/patrol.ts` | Patrol chat AI 呼叫 |
| `src/deliberation.ts` | 全圖多輪辯論（Brain Tab 的強制思考） |
| `src/idea-graph.ts` | 想法節點 CRUD + 關聯推導 |
| `src/provider.ts` | MultiProviderClient：優先 OpenCode，fallback Gemini pool |
| `src/keys.ts` | Gemini key pool，支援 import / rotate |
| `src/observation-loop.ts` | 背景定期觀察循環 |
| `src/reflection.ts` | AI 反思圖譜後注入新 idea seeds |
| `src/backlog.ts` | SQLite-backed backlog CRUD |
| `src/settings-store.ts` | DB-backed 設定（OpenCode servers、text/vision model） |
| `src/types.ts` | 所有 TypeScript 型別定義 |
| `src/index.ts` | 進入點，`web` / `observe` 兩個指令 |

---

## 3. 資料目錄結構（`data/`）

```
data/
├── autopilot.db              # SQLite: backlog + settings
├── conversation.json         # Patrol chat 歷史
├── daily-problem-pick.json   # 今日問題快取
├── idea-graph.json           # 想法節點與邊
├── mood-state.json           # 分身情緒狀態
├── graph-positions.json      # Cytoscape 節點位置
├── ideas/                    # 每個 idea 一個 JSON 檔
├── ideas-dismissed/          # 已 dismiss 的 ideas
├── problem-signals/          # 每筆訊號一個 JSON
├── problem-briefs/           # 每筆問題簡報一個 JSON
├── problem-deliberations/    # 每張卡辯論結果 JSON
└── observation-*.json/.md    # 每次觀察輸出
```

---

## 4. 部署流程

```
git push → GitHub Actions (ci.yml) → docker-publish.yml
→ ghcr.io/chuangkevin/kevin-autopilot:latest
→ deploy-dev.yml (self-hosted runner) → docker pull + restart
→ 健康檢查 http://100.83.112.20:3023/health
```

- **容器 port**: 3023（內外一致）
- **本機 URL**: http://100.83.112.20:3023
- **Tailscale URL**: https://kevin.sisihome.org
- **設定檔路徑**: `/config/kevinhome.json`（掛載在 docker volume）
- **資料目錄**: `./data` 掛載到容器內 `/data`（由 config dataDir 指定）

本機建 image（公司筆電需繞 TLS proxy）→ 見 `AGENTS.md` 的「Local Docker Build From The Corporate Dev Box」段落。

---

## 5. 設定檔格式（config.json）

```json
{
  "environment": "production",
  "dataDir": "/data",
  "ai": {
    "enabled": true,
    "provider": "gemini",
    "model": "gemini-2.0-flash"
  },
  "backgroundObservation": {
    "enabled": true,
    "intervalMs": 600000
  },
  "ruleSources": [...],
  "repositories": [...],
  "services": [...]
}
```

OpenCode 端點和 Gemini 金鑰可透過 UI `/settings` 設定後存入 SQLite，不需要改 config 檔。

---

## 6. 本次 session 的主要變更（2026-05-25）

### 6a. Per-card 多角色辯論 (commit `671c16d`)
- 新增 `src/problem-deliberation.ts`：4 角色（工程師/設計師/風險/休假 Kevin）× 2 輪
- 每張卡展開時自動觸發，結果快取 → 不重複呼叫 AI
- API: `GET /api/problem-deliberation/{briefId}`, `POST /api/problem-deliberation/{briefId}`
- web.ts 新增辯論 UI 區塊和前端 polling JS

### 6b. 訊號品質修正 (commits `54c9620`, `978c42e`, `7ff2704`)
- HN 訊號：用 `stripHtml()` 清理 HTML 實體和標籤再存入
- `inferWorkflow()` 改為中文專屬 regex（避免 `line/file` 等英文詞誤觸）
- 每次全量跑時刪除不再有訊號支撐的舊 briefs（移除 14 天 grace period）
- 只 prune 有 `idea:` / `supplement:` / `backlog:` 前綴的訊號（保留手動 ingest）

### 6c. 響應式布局修正 (commit `05d2a87`)
- 桌面三欄從 768px 改為 **1024px** 觸發（768px 時中欄只有 96px → 不可用）
- 640px–1023px：main + tab bar 展開至 **100% 視窗寬度**
- 漸進式欄寬：1024/1300/1600/1920/2560px 各有對應值
- 驗證解析度：640×480, 768×1024, 1024×768, 1440×900, 1920×1080, 3840×2160, iPhone 15 Pro, Poco F5 Pro

---

## 7. 問題發現 Pipeline 說明

```
外部訊號                    內部訊號
HN Algolia API    ──┐      idea:*/supplement:*/backlog:*
Reddit JSON API   ──┤      手動 POST /api/problem-signal/ingest
                    ↓
            upsertProblemSignals()
            (dedup by sourceName, 保留原始文字)
                    ↓
            pruneStaleInternalSignals()
            (刪掉已不存在的 idea/supplement/backlog 訊號)
                    ↓
            buildProblemBriefs()
            (extractProblemPattern → 分群 → 評分)
            (只保留本次有訊號支撐的 briefs)
                    ↓
            evaluateProblemCandidates() [AI]
            (分 pick / worth / evidence / notnow 四層)
                    ↓
            visibleProblemBriefs()
            (排序、限筆數 → 前端卡片)
```

---

## 8. AI Provider 路由

```
config.ai.enabled == false  → 不呼叫 AI
OpenCode servers 已設定      → 優先走 OpenCode (remote session)
否則                         → Gemini key pool (隨機選 key，429 自動換下一個)
```

`MultiProviderClient` 在 `src/provider.ts`，各功能呼叫 `getProvider(config).generateContent({...})`。

---

## 9. 開發指令

```bash
npm run build     # tsc 編譯
npm test          # 176 個單元/整合測試（需要 Node 22）
npm run web       # 啟動 web 伺服器（需要 KEVIN_AUTOPILOT_CONFIG 環境變數）
```

---

## 10. 已知狀況 / 待跟進

| 項目 | 狀況 |
|---|---|
| Android UI 驗證（v0.15.0 deliberation） | 尚未做過實機截圖驗證 |
| 3840×2160 原生 100% DPI | 內容正確但物理上很小；OS DPI 縮放（200%）下正常 |
| OpenCode session payload | 已由 `@kevinsisi/ai-core v3.4.3` 修正 |
| 問題卡辯論 30s timeout | 若 AI 慢，卡片辯論可能回 null；重新滑入會重試 |
