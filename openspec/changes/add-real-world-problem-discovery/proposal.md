## Why

Kevin Autopilot has drifted toward graph UI, infra monitoring, and technical self-observation. Those are useful support systems, but they are not the product's north star.

Kevin's HomeProject pattern is broader and more product-oriented: find messy real-world workflows, identify who is wasting time or working around broken processes, and turn that pain into a runnable small product. Existing projects show this repeatedly: car listing operations, photo/video processing for non-experts, public-learning automation, PM-to-prototype tooling, personal emotional memory, and photo/video-to-CAD bridges.

The system needs a new primary capability: daily discovery of real-world problem opportunities. It should not ask "what new technology is interesting?" It should ask "which group of people is struggling with a repeated workflow, what workaround are they using, and what small product could Kevin build to test a solution?"

## What Changes

- Add a new `real-world-problem-discovery` capability that models:
  - `Signal`: raw external or Kevin-owned observation with URL/source/snippet/fetched time.
  - `ProblemPattern`: `people + workflow + pain + workaround` extracted from one or more signals.
  - `ProblemBrief`: evidence-backed, readable problem card.
  - `Opportunity`: Kevin-fit product hypothesis with MVP and validation plan.
  - `DailyPick`: the one problem worth showing first today.
- Change the default dashboard semantics from graph-first to problem-first:
  - The first screen SHALL answer: "今天哪群人的哪個流程正在被爛工具、人工繞路、資訊混亂、平台限制拖累？"
  - The graph becomes a secondary exploration/debug view, not the default product surface.
- Add read-only source discovery from approved public sources and Kevin-owned inputs. First version should prefer small curated source sets over broad crawling.
- Add AI classification that rejects generic technology trends unless they are tied to a real people/workflow/pain/workaround chain.
- Add scoring/ranking focused on real pain, evidence quality, workaround clarity, Kevin fit, one-day MVP feasibility, and validation path.

## Capabilities

### New Capabilities

- `real-world-problem-discovery`: owns signal ingestion, problem-pattern extraction, problem brief persistence, opportunity scoring, and daily pick generation.

### Modified Capabilities

- `double-research-loop`: schedules and invokes problem discovery after observation cycles or on demand. Its role shifts from producing graph activity to producing evidence-backed problem opportunities.
- `neural-cockpit`: demotes graph-first UI. The cockpit's primary tab becomes `今日真實問題`; graph remains accessible as supporting exploration.
- `idea-graph`: may visualize relationships among problem briefs, people groups, workflows, workarounds, and existing HomeProject projects, but it is not the primary decision surface.

## Impact

- **Expected new files:** `src/problem-discovery.ts`, `src/problem-discovery.test.ts`, possibly `src/problem-sources.ts` for source adapters.
- **Expected modified files:** `src/types.ts`, `src/observation-loop.ts`, `src/web.ts`, `src/idea-graph.ts`, `README.md`, `AGENTS.md`, `src/version.ts`, package metadata, deploy expected version.
- **Persisted data:** Autopilot-owned files under `data/problem-signals/`, `data/problem-briefs/`, and `data/daily-pick.json` or equivalent SQLite tables if the implementation chooses DB-backed storage.
- **No target repo mutation:** this feature remains read-only. It can generate MVP briefs and OpenCode prompts, but it must not create repos, deploy, commit, push, contact external users, spend money, or post publicly without explicit approval.
- **External-source boundary:** only public/approved sources are allowed. Private groups, authenticated user accounts, paid APIs, and scraping that violates terms are out of scope until explicitly approved.
