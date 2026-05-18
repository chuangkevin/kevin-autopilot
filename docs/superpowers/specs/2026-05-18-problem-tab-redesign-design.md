# 問題 Tab 重設計

**Date:** 2026-05-18
**Status:** Approved — ready for implementation planning

## Goal

把「問題」tab 改成真正的問題蒐集決策入口：
- 手機上左右滑動瀏覽不同問題卡片
- 蒐集外部世界（HN、Reddit、Threads 台灣、手動貼入）的真實問題
- 讓 Kevin 快速決定哪些問題值得實作

## Card UX

### 版面結構

- **全螢幕疊牌**：一次顯示一張卡，下方卡疊在後面
- **左右滑動 = 純導覽**（上一張 / 下一張），不帶判斷語意
- dot indicator 顯示目前位置（第 N / 共 M 張）
- **卡片順序**：daily pick 第一張，其餘候選照 rank 混排

### 卡片正面（hook）

顯示：
- Tier badge（★ 今日精選 / 值得追 / 先補證據 / 暫時不追）
- 來源 badge（HN / Reddit / Threads / 手動 / Kevin-owned）
- 標題（大字，一句話問題描述）
- 一行 lede（人群 + 流程一句話）
- 分數 / evidence count / confidence
- 「↑ 上滑看詳情」提示
- 四個 feedback 按鈕：有趣 ★ / 無聊 / 不是問題 / 再找類似
- 底部貼入列（常駐，見下）

不同 tier 用不同邊框色：
- 今日精選：綠色（`rgba(34,197,94,.5)`）
- 值得追：藍色（`rgba(99,102,241,.5)`）
- 先補證據：琥珀色（`rgba(245,158,11,.4)`）
- 暫時不追：灰色 + 降低透明度

### 展開詳情（上滑）

2-col grid：
- 誰痛
- 痛在哪
- 現在怎麼撐
- 一週 MVP
- 驗證方式（全寬）

下方：
- 證據片段（原文引用 + 來源標記）
- 排序理由 / 為何今天選它

### 底部貼入列（常駐）

Tab 底部固定顯示輸入欄：
```
[貼入 URL 或文字 _______________] [送出]
```
信任閘道保護（loopback / private LAN / Tailscale）。

## 外部來源

### Hacker News

- 來源：Algolia HN Search API（`https://hn.algolia.com/api/v1/search`）
- 抓取標的：`tags=ask_hn` 和 `tags=show_hn`
- 搜尋關鍵字：workflow、productivity、tool、annoying、broken、manual、automate 等
- 排程：每 2 小時
- sourceType：`hacker-news`

### Reddit

- 來源：公開 JSON API（`https://www.reddit.com/r/SUBREDDIT/.json`），無需帳號
- 初始 subreddits：`r/smallbusiness`、`r/freelance`、`r/productivity`、`r/SideProject`
- 排程：每 2 小時
- sourceType：`reddit`

### Threads 台灣

- Meta Threads 目前無公開 API，自動爬取不穩定且可能違反 ToS
- **做法：手動貼入**（使用者看到有趣貼文，複製貼到輸入欄）
- sourceType：`threads-tw`
- 卡片顯示 Threads badge

### 手動貼入（即時）

流程：
1. 使用者貼入 URL 或文字 → `POST /api/problem-signal/ingest`（信任閘道）
2. 若為 URL：server 端 fetch 頁面，萃取文字
3. 建立 ProblemSignal → 重跑 `buildProblemBriefs`
4. 新卡片出現在 stack 最前面，頁面即時更新（polling 或 reload）

## 資料流

```
HN (Algolia, 2hr)   ──┐
Reddit (JSON, 2hr)  ──┤
手動貼入 (即時)      ──┼──→ ProblemSignal 記錄 (data/problem-signals/)
Kevin-owned signals ──┘         ↓
                        buildProblemBriefs (現有，不改)
                                ↓
                        DailyPick + 候選池
                                ↓
                        問題 tab 滑卡
```

## 新增的程式範圍

### 新檔案

- `src/external-sources.ts` — HN fetcher、Reddit fetcher；export `fetchHackerNewsSignals()`、`fetchRedditSignals()`
- `src/external-sources.test.ts`

### 修改的檔案

- `src/problem-discovery.ts` — `collectKevinOwnedSignals` 改為 `collectAllSignals`，整合外部來源
- `src/web.ts` — 問題 tab 改為滑卡；新增 `POST /api/problem-signal/ingest` endpoint；新增 `renderProblemStack()` 取代現有 `renderProblemTab()`
- `src/web.test.ts` — 新增滑卡 HTML 測試、ingest endpoint 測試
- `src/types.ts` — `ProblemSignalSourceType` 加上 `hacker-news`、`reddit`、`threads-tw`
- `src/observation-loop.ts` — 週期觸發時一起跑外部來源 fetch

### 不改的部分

- `buildProblemBriefs`、`buildRejectedProblemSummary`、評分邏輯、feedback API — 全部不動

## 非功能需求

- 外部 fetch 有 per-source timeout（10s），單一來源超時不擋其他來源
- 手動貼入 URL fetch 有 5s timeout；失敗回傳明確錯誤訊息，不靜默忽略
- 外部來源 fetch 失敗只 log，不中斷排程
- 去重依賴現有 `dedupKey`（`shortHash(sourceType + sourceName + title + snippet[:240])`）
- 公開 endpoint 不暴露原始 snippet；信任閘道 ingest 才能寫入
