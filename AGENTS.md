# Kevin Autopilot Agent Rules

Before making decisions in this repo, read:

1. The resolved `homelab-docs/AGENTS.md` for the current environment.
2. The resolved `homelab-docs/kevin-ai-persona/PERSONA.md` for the current
   environment.

Do not assume one machine-specific HomeProject path. Prefer `OPENCODE_DIRECTORY`
or configured/mounted rule-source paths, then common HomeProject roots only as a
fallback during local development.

Kevin approved the v0.1 Dockerized observer, v0.2 idea-intake prototype, v0.3
key import / agent handoff metadata, v0.4 kevinhome deployment, v0.5
read-only project handoff plan work, v0.5.3 settings-page DB-backed key
management, v0.5.4 key-manager paste/mobile layout fixes, v0.5.5 GMT+8
display time, v0.5.6 read-only Observation Backlog, v0.5.7 bounded OpenCode
prompts for observation candidates, v0.5.8 dashboard usage guidance / copy
prompt UX, v0.5.9 Kevin sub-persona main-agent self-Q&A with Autopilot-owned
dashboard supplements, v0.5.10 consolidated decision-center dashboard flow,
v0.5.11 single-focus recommendation card, v0.5.12 explicit dashboard goal copy
that separates judgment correction from new product goals, v0.5.13 explicit
manual-only/no-background-loop status copy, v0.5.14 idea desktop cards with
existing-project similarity analysis, v0.5.15 read-only background observation
loop status, v0.5.16 visible auditable thinking trace, v0.5.17 Kevin-style
thinking quality review, v0.5.18 evidence-gap-driven quality review,
v0.5.19 all-project Project Radar, v0.5.20 multi-item Priority Board,
v0.5.21 non-prioritized Observation Workbench, v0.6.0 Neural Cockpit / idea
graph that makes Kevin Autopilot feel like a visible read-only double brain, and
v0.6.1 background graph refresh with dream behavior treated as metaphor rather
than a literal keyword, v0.7.0 Durable Backlog cockpit UI/API actions for
recurring observation signals, v0.7.1 explicit Neural Cockpit disabled-action
reasons, v0.8.0 functional Neural Cockpit actions for relationship finding,
OpenCode prompt copying, interesting marks, and stop-exploring metadata, and
v0.8.1 automatic idea extension nodes, and v0.9.0 bounded public web research
findings via cached read-only DuckDuckGo Instant Answer queries, and v0.10.0
Neural Cockpit hub-spoke focus interaction with inline edge labels plus
signature-based EXTENSION dedup that retires the timestamp-suffix id scheme
and collapses legacy duplicates on graph load, v0.10.1 legible focus state
(right-panel title tracks focused node, "聚焦：X" chip, clearer status
copy), and v0.11.0 the AI graph reflection module that mints
evidence-backed AI idea seeds and AI-rewritten nextExploration on every
graph-changed cycle with a pending cap, dismiss path, token cap, and
fail-soft skip records, and v0.12.0 trusted-settings runtime overrides for
the safe whitelist `aiReflection.enabled`, `aiReflection.maxOutputTokens`,
`aiReflection.maxPendingAiIdeas`, `backgroundObservation.enabled`, and
`backgroundObservation.intervalMs` via `/settings` and Autopilot-owned
`data/runtime-overrides.json`, plus v0.12.x Neural Cockpit question-thinking
where graph nodes surface "分身正在問" premise/evidence/counterexample questions
and repeated extension clicks create readable continuation branches rather than
duplicate bubbles, and v0.13.0 Android Mode with adaptive observation timer
(excited/cooling/normal modes, 60 s floor) and cyberpunk neural tab UI
(分身/Backlog/圖/想法 tabs, SVG neural map, scanlines, cyan/magenta palette), and v0.14.0 interactive Cytoscape.js neural graph with drag, zoom/pan, force-directed layout, and backend-persisted node positions, and v0.15.0 multi-agent deliberation engine (分身辯論): force-think button triggers role-picker → parallel independent analysis → 2 debate rounds → synthesis, results saved to `data/deliberations/`, up to 3 seeds injected into idea graph; `ObservationLoop.forceRun()` bypasses the enabled guard for immediate cycles, and v0.17.0 persona injection: PERSONA.md mirrored into image at build time, prepended as system-instruction prefix on every reflection / boost / deliberation Gemini call so the double actually speaks like Kevin (priorities + dislikes + report shape). Deliberation switches to a fixed 4-cast (🔧 engineer / 🎨 designer / ⚠️ risk / 🛋 vacation Kevin), each carrying a distinct lens slice of PERSONA.md. New mood label (`excited` / `flow` / `tense` / `idle`) computed at end of every observation cycle from 24h signals, persisted to `data/mood-state.json`, injected into every prefix and tells deliberation which cast speaks louder. New preferences derived from archived nodes (< 10 → keyword frequency; ≥ 10 → AI theme abstraction with 24h throttle), persisted to `data/preference-cache.json`, also injected into every prefix so the double avoids previously-frozen directions. `pickRoles` retained as fallback when PERSONA.md missing. And v0.16.0 brain-tab redesign: keywords sit under the title in an accent `.kw-strip` and never ellipsize, the broken `.node-drawer { max-height: 24dvh }` mobile cap is removed so `.cockpit-panel` fills `calc(100dvh - var(--cy-h, 48dvh) - 160px)` below the graph with full discussion visible, and a sticky action bar carries three new trusted-gated per-node actions: ⚡ 多想一點 (`POST /api/idea/:id/boost` — single-node Gemini enrichment with per-node concurrency lock), 🧠 深度辯論 (`POST /api/deliberation { anchorNodeId }` — focused multi-persona debate whose step 0 re-uses the boost path so the anchor is always enriched first), and ❄ 先不要想 (`POST /api/idea/:id/archive` — hidden from default graph + observation/deliberation candidate pools). Legacy actions (extend/find-relationships/mark-interesting/copy-prompt) and `type · confidence · source` meta collapse into `🔬 詳情 ▾`. New Frozen Vault card lists archived nodes with 🔥 解凍 (`POST .../unarchive`) and 🗑 永久刪除 (`DELETE /api/idea/:id`).
Kevin approved v0.18.0 real-world problem discovery: Autopilot now turns
Kevin-owned ideas, supplements, observation candidates, and durable backlog items
into `ProblemSignal` records, deduplicates them into evidence-backed
`ProblemBrief` records, picks one `DailyProblemPick` using `Asia/Taipei` date
semantics, and makes the home dashboard open on `今日真實問題` while the graph stays
secondary. The generated OpenCode prompt is bounded to read-only research,
specification, and prototype planning; it must not create repos, deploy, spend
money, contact external users, read secrets, or mutate target projects without
explicit later approval. Kevin approved v0.18.1 to reduce boring picks: internal
repo/spec/test/CI/deploy planning snippets are rejected unless they also show a
real PM/design/user workflow, stale same-day picks are regenerated when their
brief is retired, the home dashboard shows a sanitized candidate problem pool,
and the public daily endpoint adds limited candidate summaries without exposing
the full `briefs` array. Kevin approved v0.18.2 to add a narrow calm PKM /
screenless knowledge-management problem pattern for existing digital-overwhelm,
bionic-persona, and fragmented personal-knowledge signals so the candidate pool
can show another real non-engineering workflow pain. Kevin approved v0.18.3 to
evaluate accepted problem candidates into `worth_chasing`, `needs_evidence`, and
`not_now`, show validation cards and rejected summaries, and persist trusted
dashboard feedback under `data/problem-feedback/` as Autopilot-owned ranking
metadata only. The public daily API may expose sanitized evaluations and rejected
counts, but not the full internal `briefs` array, evidence quotes, raw rejected
snippets, unmanaged secrets, or any approval to build, deploy, spend, outreach,
or mutate target repositories.

Kevin approved v0.19.0 swipeable problem tab: replaced the static 問題 tab with
a full-screen swipeable card stack powered by HN/Reddit external signals (not
Kevin-owned backlog); added manual-paste ingest endpoint, 1/N counter, and stack
depth affordance cues. Kevin approved v0.20.0 proactive patrol chat: after each
observation loop run the system calls Gemini with PERSONA.md context to decide
whether to proactively message Kevin; messages are stored in
`data/conversation.json` (max 200); Kevin can reply from the chat UI in the
problem tab and get an immediate AI response using full conversation history +
persona context. The patrol call and reply both use `buildPersonaPrefix('patrol')`
so the AI voice stays consistent with reflection and deliberation.

Keep these versions read-only: they may observe, classify, report, and store
Autopilot-owned reports/idea records/supplements, but they must not modify target
repos, create repos, deploy, commit/push other projects, or perform destructive
actions without a later explicit approval gate.

Safety rules:

1. Do not read or edit secrets, `.env*`, credential JSON, or service-account
   files, except for Autopilot-owned managed key storage under ignored `data/`.
2. Do not implement autonomous destructive actions.
3. Do not deploy.
4. Keep v0.1 read-only unless Kevin explicitly expands scope.
5. Do not implement background execution that edits repos, commits, pushes, or
   deploys until scheduler state, permission gates, interrupt handling, pending
   actions, and health/status surfaces are explicitly designed and approved.

## Local Docker Build From The Corporate Dev Box

When building the kevin-autopilot image on Kevin's company laptop, the corporate
TLS MITM proxy intercepts `https://registry.npmjs.org`, so the tracked
`Dockerfile`'s `npm ci` fails with `SELF_SIGNED_CERT_IN_CHAIN`. Do not commit a
fix that disables TLS verification globally; instead keep an untracked
`Dockerfile.local` at the repo root that copies the tracked `Dockerfile` and
adds one line in the `deps` stage:

```dockerfile
# (immediately after WORKDIR /app and apt-get install)
RUN npm config set strict-ssl false
```

Build and run from a Git Bash shell on the corporate box:

```bash
docker build -f Dockerfile.local -t kevin-autopilot:local-test .

# IMPORTANT: MSYS_NO_PATHCONV prevents git-bash from rewriting
# in-container paths like /config/... to C:/Program Files/Git/config/...
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker run -d \
  --name kevin-autopilot-local --restart unless-stopped \
  -p 127.0.0.1:3033:3023 \
  -e KEVIN_AUTOPILOT_CONFIG=/config/kevinhome.json \
  -e PORT=3023 -e TZ=Asia/Taipei \
  -v "D:/Projects/_HomeProject/kevin-autopilot/config/kevinhome.example.json:/config/kevinhome.json:ro" \
  -v "D:/Projects/_HomeProject/kevin-autopilot/data:/data" \
  -v "D:/Projects/_HomeProject/homelab-docs:/rules/homelab-docs:ro" \
  -v "D:/Projects/_HomeProject:/repos/homeproject:ro" \
  kevin-autopilot:local-test
```

Notes:

- Bind to `127.0.0.1:3033`, not 3023. The dev box often runs a host
  `node dist/index.js web` on 3023; both writing to the same `data/autopilot.db`
  causes SQLite contention. Stop the host process (`Stop-Process -Id <pid>`) or
  the container before running the other.
- The mounted `data/` already contains 50 Gemini keys in `autopilot.db`, so AI
  thinking is enabled without setting `GEMINI_API_KEY`.
- Health: `curl http://127.0.0.1:3033/health` returns
  `{"ok": true, "version": "<APP_VERSION>"}`. Public domain
  `https://kevin.sisihome.org/health` is only reachable from inside the home
  Tailnet; corporate-box curl to it timing out is expected.
- `Dockerfile.local` stays untracked. Do not propose committing it; the corp
  workaround is environment-specific and the published CI/CD image uses the
  tracked `Dockerfile` from a clean GitHub Actions runner without the MITM.
