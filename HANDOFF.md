# Kevin Autopilot — 交接文件

> 版本：**v1.0.0 · World Problem Radar** · 更新日期：2026-05-28

舊版 v0.20.0（Autopilot 多分頁產品 — Brain Tab / Graph Tab / Patrol Chat / per-card 辯論）在 2026-05-26 已被整批 teardown。本檔對應**現行 code**，不是過去的 autopilot。

---

## 1. 是什麼

一個單人用的「人類痛點雷達」。系統從公開來源（HN Show/Ask + 指定 subreddits）抓貼文 + 接收 Kevin 手動貼上的觀察，每筆走三段 AI pipeline：

```
keep / skip  →  結構化 pain card  →  2–4 個想法方向（unordered）
```

產出一個**反時間序、不評分、不排名**的痛點卡片流。系統明確不做的事：不打分、不挑「最佳」、不推薦方向、不收斂注意力。Idea seeds 是並列的選項，不是建議。

權威 spec：`openspec/specs/world-problem-radar/spec.md`（v1.0.0 起為 OpenSpec 唯一正本，2 個 active capability：`world-problem-radar` + `runtime-overrides`）。

---

## 2. 技術架構

```
TypeScript strict + Node 22 ESM
node:sqlite (built-in) ── 不裝 better-sqlite3
無前端框架 ── web.ts 直接 render HTML/CSS/JS 字串
AI: @kevinsisi/ai-core v3.4.3 → MultiProviderClient
    OpenCode primary → Gemini key-pool fallback
```

### 主要原始檔（`src/`）

| 檔案 | 職責 |
|---|---|
| `index.ts` | 進入點。startup 跑一次 scan，之後 `setInterval` 每 `radarScan.intervalMs` 跑一次（預設 4h）。最後啟動 web server。 |
| `radar.ts` | `runRadarPipeline`：對每筆 signal 跑 extract → structure → seeds 三階段，結果寫進 `problem_cards`。Token budget 常數在檔頭（256/1024/1024）— 不要再砍。 |
| `external-sources.ts` | HN Algolia + Reddit JSON。`Promise.all` 平行抓，per-source timeout 10s，單一來源失敗不影響另一個。 |
| `problem-cards.ts` | `${dataDir}/radar.db` 的 schema 與 CRUD：`raw_signals` + `problem_cards`。 |
| `provider.ts` | MultiProviderClient 路由策略：OpenCode 優先、Gemini key-pool fallback、`allowCrossProviderFallback: true`。 |
| `keys.ts` | Gemini key-pool（檔案 + env），429 自動輪替。Key 存在 `autopilot.db` 的 keys table。 |
| `settings-store.ts` | `autopilot.db` 的 `kv_settings` table：OpenCode servers / text & vision model / variant。 |
| `runtime-overrides.ts` | 白名單 override（`radarScan.enabled` / `radarScan.intervalMs`），檔案在 `${dataDir}/runtime-overrides.json`。 |
| `config.ts` | 載 `KEVIN_AUTOPILOT_CONFIG` 指的 JSON、validate `environment` / `dataDir` / `radarScan.intervalMs >= 60_000`。 |
| `web.ts` | HTTP server、所有路由、整個前端 render（見下方路由表）。 |
| `types.ts` | 全部型別。`AutopilotConfig`、`ProblemSignal`、`ProblemCard`、`RuntimeOverrides`、`AiConfig`。 |
| `version.ts` | `APP_VERSION`（手動 sync 到 `package.json`）。 |

每個 prod 檔都有對應的 `*.test.ts`（node:test）。

---

## 3. 資料目錄（`${dataDir}` → 容器內 `/data`）

| 路徑 | 用途 | 是否能砍 |
|---|---|---|
| `radar.db` | 痛點卡片 DB（`raw_signals` + `problem_cards`） | **不能** |
| `autopilot.db` | KV settings（OpenCode 設定） + Gemini key 儲存 | **不能** |
| `runtime-overrides.json` | 白名單 override 持久檔 | 可重建（刪了等於還原 file config） |

`data/` 在 `.gitignore` 裡，所有檔都是 runtime 產出。舊 autopilot 殘檔（`idea-graph.json` / `mood-state.json` / `observation-*.json` / `ideas/` / `problem-signals/` / `problem-deliberations/`）在 2026-05-28 cleanup 一併清掉。

---

## 4. HTTP 路由（`src/web.ts`）

| Method | Path | 用途 |
|---|---|---|
| GET | `/health` | 健康檢查（永遠回 200） |
| GET | `/` | 痛點卡片 feed（HTML） |
| GET | `/settings` | 設定頁（HTML） |
| GET | `/api/radar/cards` | 卡片 JSON（時間倒序，無評分欄位） |
| POST | `/api/radar/scan` | 即刻觸發一次 scan |
| POST | `/api/radar/paste` | Kevin 手動貼文 → `manual` signal |
| GET | `/api/keys`、`/api/keys/status` | Gemini key 狀態 |
| POST | `/api/keys/import` | 匯入 Gemini keys（**trust-gated**：loopback / 私網 / Tailscale 才放行） |
| POST | `/api/keys/clear` | 清空 Gemini keys（**trust-gated**） |
| GET/POST/DELETE | `/api/settings/opencode` | OpenCode server 設定（未 trust-gated） |
| GET | `/api/settings/opencode/models` | 取可用 model 列表 |
| GET/POST | `/api/runtime-overrides` | 讀/寫 white-listed runtime overrides（未 trust-gated） |

`isTrustedSettingsRequest` 目前**只**用在 `/api/keys/import` 與 `/api/keys/clear`。OpenCode / runtime-overrides 路由沒掛這道閘——目前是靠 Tailscale-only port binding 撐安全邊界。要硬化的話 grep `isTrustedSettingsRequest` 補上即可。

---

## 5. 部署

```
git push (main)
  → GitHub Actions:  ci.yml (build + test)
  → docker-publish.yml  → ghcr.io/chuangkevin/kevin-autopilot:latest
  → deploy-dev.yml (self-hosted runner)  → docker pull + restart
  → health check:  http://100.83.112.20:3023/health  +  https://kevin.sisihome.org
```

- 容器 port：**3023**（內外一致；compose 綁 `100.83.112.20:3023` 走 Tailscale）
- 本機 build：見 `AGENTS.md` 的「Local Docker Build From The Corporate Dev Box」段——公司筆電 TLS MITM 會擋 `npm ci`，用 `Dockerfile.local` 繞，**不要**把 workaround 提交到 `Dockerfile`。
- Compose mount：`./data:/data`、`./config/kevinhome.example.json:/config/kevinhome.json:ro`、外加唯讀的 homelab-docs 與 _HomeProject 給 AI 看的 rules / repos mount。

部署健康閘的判讀規則：**信 workflow 日誌，不要信本機 curl 結果**（見 memory `deploy_health_gate`）。

---

## 6. 設定檔（`KEVIN_AUTOPILOT_CONFIG` 指向的 JSON）

```json
{
  "environment": "production",
  "dataDir": "/data",
  "ai": {
    "enabled": true,
    "provider": "gemini",
    "model": "gemini-2.0-flash"
  },
  "radarScan": {
    "enabled": true,
    "intervalMs": 14400000
  }
}
```

OpenCode 端點與 Gemini key 走 UI `/settings` 存進 `autopilot.db`，不需要動這個檔。Scan 間隔可以走 `runtime-overrides.json` 即時覆寫（範圍 60_000–86_400_000）。

---

## 7. Pipeline

```
fetchExternalSignals()
  ├─ fetchHackerNewsSignals()  ── HN Algolia (show_hn + ask_hn, 30/page)
  └─ fetchRedditSignals()      ── ['programming','ExperiencedDevs','SaaS','startups'], 25/sub
        ↓
runRadarPipeline(config, db, signals)
  for each signal:
    upsertRawSignal()
    if no provider     → markSignalProcessed(skipped)
    extractSignal()    → keep/skip JSON   (timeout 15s, 256 tokens)
        if skip        → markSignalProcessed(skipped)
    structureCard()    → who/pain/context/workaround/urgency  (timeout 20s, 1024 tokens)
        if null        → markSignalProcessed(skipped)
    generateIdeaSeeds()→ ≤4 unordered strings  (timeout 20s, 1024 tokens)
    insertProblemCard()
    markSignalProcessed(done)
```

任何單階段例外都靜默吞掉並把 signal 標 `skipped`，pipeline 不會中斷。Token budget 常數**不能**降——降到太緊 JSON 會被截在 value 中段，整筆 silently drop（這就是 `90519af` / `f6235db` 修的）。

---

## 8. AI Provider 路由

```
config.ai.enabled === false     → 全部 stage 跳過，只存 raw signals
有 OpenCode servers              → MultiProviderClient 走 OpenCode
否則                              → Gemini key pool（429 自動換 key）
兩者都沒有                        → 不呼 AI，signal 全 skipped
```

OpenCode 預設 model：`openai/gpt-5.5` (text + vision)，variant `medium`。可在 `/settings` 改。

---

## 9. 指令

```bash
npm run build      # tsc -p tsconfig.json
npm test           # node --test dist/**/*.test.js  (需 build 過 + Node ≥22)
npm run web        # node dist/index.js web
```

Commit 前的 build gate：`npx tsc --noEmit` exit 0 + 改到的範圍 `npm test` 過。

---

## 10. 已知 gap / 待跟進

| 項目 | 狀況 |
|---|---|
| **`docs/goal.md` 描述的是另一個產品** | goal.md (5/26) 寫的是 PCCS Thread Overview / Cost Engine / Counterfactual View 的多執行緒成本追蹤器。現行 code = 痛點雷達（HN/Reddit → 痛點卡）。如果 thread-cost 才是真的目標方向，spec 要重寫，code 要重做；現在 spec 寫的是「code 實際做了什麼」。 |
| **`radarScan.enabled = false` 不會真的停掉 scan** | `applyRuntimeOverrides` 會把值 merge 進 effective config，但 `index.ts` 的 `setInterval` 沒有讀這個 flag——所以這個 override 目前無效。要修就在 `runScan` 開頭加 `if (!effective.radarScan?.enabled) return`。 |
| **設定相關 API 沒有 trust gate** | `/api/runtime-overrides`、`/api/settings/opencode*` 任何能連到 port 3023 的客戶端都能改。靠 Tailscale-only 綁定撐邊界。要硬化補上 `isTrustedSettingsRequest` 即可。 |
| **`docs/goal.md` 與 OpenSpec 不同步** | 整個 radar 重寫沒走 OpenSpec propose→apply→archive 流程，是用 docs/ 推的。新規定（`CLAUDE.md`、`openspec_workflow_expectations` memory）要求非小型功能要走完整 OpenSpec cycle。 |

---

## 11. OpenSpec 現況（2026-05-28 reconciled）

```
openspec/
├── changes/
│   └── archive/                          ← 全部歷史
│       ├── SUPERSEDED-2026-05-26-world-problem-radar.md  ← 說明 v1 rebuild teardown
│       ├── 2026-05-13-…   (8 個 autopilot v0.1–v0.6 變更)
│       └── 2026-05-19-…   (6 個 v0.15–v0.20 變更，被 radar rebuild 整批 supersede)
└── specs/
    ├── world-problem-radar/spec.md       ← 8 requirements
    └── runtime-overrides/spec.md         ← 5 requirements（已改寫成 radar schema）
```

`openspec list` 顯示 0 active changes — 全部 reconciled 進 archive。任何新功能都該走 `/openspec-propose` 開新 change。
