import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebServer, formatTaipeiTime, isTrustedSettingsAddress, isTrustedSettingsSource } from './web.js'
import { mergeCandidatesIntoBacklog, openBacklogDatabase } from './backlog.js'
import { saveRuntimeOverrides } from './runtime-overrides.js'
import type { AutopilotConfig, ObservationCandidate } from './types.js'

const GEMINI_KEY = `AIzaSy${'C'.repeat(33)}`

test('isTrustedSettingsAddress allows private and Tailscale networks only', () => {
  assert.equal(isTrustedSettingsAddress('127.0.0.1'), true)
  assert.equal(isTrustedSettingsAddress('::ffff:192.168.1.5'), true)
  assert.equal(isTrustedSettingsAddress('10.0.0.8'), true)
  assert.equal(isTrustedSettingsAddress('172.20.0.2'), true)
  assert.equal(isTrustedSettingsAddress('100.83.112.20'), true)
  assert.equal(isTrustedSettingsAddress('8.8.8.8'), false)
})

test('formatTaipeiTime displays GMT+8 time', () => {
  assert.equal(formatTaipeiTime('2026-05-10T16:00:00.000Z'), '2026/05/11 00:00:00 GMT+8')
})

test('isTrustedSettingsAddress protects supplement writes', () => {
  assert.equal(isTrustedSettingsAddress('8.8.8.8'), false)
  assert.equal(isTrustedSettingsAddress('100.64.0.1'), true)
  assert.equal(isTrustedSettingsSource('172.20.0.2', '8.8.8.8'), false)
  assert.equal(isTrustedSettingsSource('172.20.0.2', '100.83.112.20'), true)
  assert.equal(isTrustedSettingsSource('127.0.0.1', ['100.83.112.20, 192.168.1.5']), true)
  assert.equal(isTrustedSettingsSource('127.0.0.1', undefined, '203.0.113.10'), false)
})

test('web server exposes health and idea intake', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-web-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [
      { name: 'missing-repo', path: join(dataDir, 'missing') },
      ...Array.from({ length: 12 }, (_, index) => ({ name: `missing-repo-${index + 2}`, path: join(dataDir, `missing-${index + 2}`) })),
    ],
    services: [
      {
        name: 'Broken Service',
        source: 'test',
        healthCheck: { enabled: true, url: 'http://127.0.0.1:1/health', timeoutMs: 50 },
      },
    ],
  }
  const backlogCandidate: ObservationCandidate = {
    id: 'repository-missing-repo-repeat-signal',
    category: 'bug_watch',
    confidence: 'likely',
    title: 'Missing repo keeps recurring',
    sourceType: 'repository',
    sourceName: 'missing-repo',
    evidence: ['first pass saw repository path missing'],
    expectedBehavior: 'Configured repositories should be reachable for observation.',
    actualBehavior: 'The same missing repository path appeared again.',
    suggestedNextStep: 'Confirm whether the repository mapping is still correct.',
    approvalRequired: false,
    risk: 'medium',
    boundedPrompt: 'Inspect the missing repo mapping without changing target repos.',
  }
  const backlogDb = openBacklogDatabase(config)
  try {
    mergeCandidatesIntoBacklog(backlogDb, [backlogCandidate], new Date('2026-05-11T00:00:00.000Z'))
    mergeCandidatesIntoBacklog(
      backlogDb,
      [{ ...backlogCandidate, evidence: ['second pass saw the same missing repository path'] }],
      new Date('2026-05-12T00:00:00.000Z'),
    )
  } finally {
    backlogDb.close()
  }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`

    const health = await fetch(`${baseUrl}/health`)
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('cache-control'), 'no-store, max-age=0')
    assert.equal((await health.json()).environment, 'test')

    const page = await fetch(`${baseUrl}/`)
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('cache-control'), 'no-store, max-age=0')
    const pageBody = await page.text()
    // Cyberpunk tab-based dashboard — content that moved to stub tab panels is no longer rendered inline
    assert.equal(pageBody.includes('設定 Gemini Keys'), false) // moved to /settings; header now shows 'SYS ⚙'
    assert.equal(pageBody.includes('分身現在能做什麼'), false) // capability brief moved to brain tab stub
    assert.equal(pageBody.includes('分身正在問'), true) // still present in JS renderNodeDrawer helper
    assert.equal(pageBody.includes('它不是自動改 code'), false) // moved to stub
    assert.equal(pageBody.includes('時間都用 GMT+8 顯示'), false) // moved to stub
    assert.equal(pageBody.includes('自己巡 HomeProject'), false) // moved to stub
    assert.equal(pageBody.includes('產生 bounded prompt'), false) // moved to stub
    assert.equal(pageBody.includes('Kevin Autopilot Neural Cockpit'), false) // moved to graph tab stub
    assert.equal(pageBody.includes('Durable Backlog'), false) // moved to backlog tab stub
    assert.equal(pageBody.includes('過去反覆看過的問題'), false) // moved to stub
    assert.equal(pageBody.includes('Missing repo keeps recurring'), false) // moved to stub
    assert.equal(pageBody.includes('seen 2'), false) // moved to stub
    assert.equal(pageBody.includes('上次留下的證據'), true) // still in JS renderEvidenceBox
    assert.equal(pageBody.includes('Snooze 7 天'), true) // still in JS renderBacklogItem
    assert.equal(pageBody.includes('這裡不是重要性排名'), false) // moved to stub
    assert.equal(pageBody.includes('Priority Board'), false)
    assert.equal(pageBody.includes('找更多關聯'), false) // moved to stub
    assert.equal(pageBody.includes('變成 OpenCode 任務'), false) // moved to stub
    assert.equal(pageBody.includes('標記有趣'), false) // moved to stub
    assert.equal(pageBody.includes('先不要想這條'), false) // moved to stub
    assert.equal(pageBody.includes('尚未開放關聯搜尋'), false)
    assert.equal(pageBody.includes('缺 prompt 或證據太弱'), false)
    assert.equal(pageBody.includes('打開分身的大腦'), false) // moved to stub
    assert.equal(pageBody.includes('像作夢一樣的半醒聯想'), false) // moved to stub
    assert.equal(pageBody.includes('brain-node'), true) // still in CSS
    assert.equal(pageBody.includes('node-drawer'), true) // still in CSS
    assert.equal(pageBody.includes('快速丟一段文字，不必整理格式'), false) // moved to stub
    assert.equal(pageBody.includes('目前背景觀察已關閉'), false) // moved to stub
    assert.equal(pageBody.includes('不會自己改 repo、commit、push、部署'), false) // moved to stub
    assert.equal(pageBody.includes('安全邊界：我可以做夢、聯想、觀察、整理、延伸、產生 prompt'), false) // moved to stub
    assert.equal(pageBody.includes('補充或修正分身這輪判斷'), false) // moved to stub
    assert.equal(pageBody.includes('Observation Workbench'), false) // moved to stub
    assert.equal(pageBody.includes('一次看多件，每件都保留位置'), false) // moved to stub
    assert.equal(pageBody.includes('建議模式：先補證據'), false) // moved to stub
    assert.equal(pageBody.includes('workbench-card'), true) // still in CSS
    assert.equal(pageBody.includes('分身思考過程'), false) // moved to stub
    assert.equal(pageBody.includes('我怎麼判斷下一步'), false) // moved to stub
    assert.equal(pageBody.includes('這不是模型私有 chain-of-thought'), false) // moved to stub
    assert.equal(pageBody.includes('像 Kevin 嗎？'), false) // moved to stub
    assert.equal(pageBody.includes('差在哪'), false) // moved to stub
    assert.equal(pageBody.includes('/100'), false) // moved to stub
    assert.equal(pageBody.includes('/api/main-agent/thinking'), false) // moved to stub
    assert.equal(pageBody.includes('分身現在在想'), false) // was in neural cockpit HTML; moved to stub
    assert.equal(pageBody.includes('我怎麼理解它'), true) // still in JS renderNodeDrawer
    assert.equal(pageBody.includes('修正這輪判斷'), false) // moved to stub
    assert.equal(pageBody.includes('除錯/證據/完整清單，不用先看'), false) // moved to stub
    assert.equal(pageBody.includes('Kevin 子人格自問自答'), false) // moved to stub
    assert.equal(pageBody.includes('修正下一輪判斷'), false) // moved to stub
    assert.equal(pageBody.includes('Active Task'), false) // moved to stub
    assert.equal(pageBody.includes('Observation Backlog'), false) // moved to stub
    assert.equal(pageBody.includes('OpenCode prompt'), true) // still in JS
    assert.equal(pageBody.includes('複製 Prompt'), true) // still in JS
    assert.equal(pageBody.includes('Project Radar'), false) // moved to stub
    assert.equal(pageBody.includes('所有專案都在雷達上'), false) // moved to stub
    assert.equal(pageBody.includes('不替你判斷哪個想法比較重要'), false) // moved to stub
    assert.equal(pageBody.includes('missing-repo'), false) // moved to stub
    assert.equal(pageBody.includes('navigator.clipboard'), true)
    assert.equal(pageBody.includes("document.execCommand('copy')"), true)
    assert.equal(pageBody.includes('Prompt 已複製'), true)
    assert.equal(pageBody.includes('.cockpit-panel { max-height: clamp(520px, 62vh, 720px); overflow-y: auto; overflow-x: hidden; touch-action: pan-y; }'), true)
    assert.equal(pageBody.includes('id="node-action-bar"'), false) // was in neural cockpit HTML; moved to stub
    assert.equal(pageBody.includes('setTimeout(() => location.reload(), 900)'), false)
    assert.equal(pageBody.includes('focusedNodeId = detail.node.id'), true)
    assert.equal(pageBody.includes('refreshGraphInPlace(focusedNodeId)'), true)
    assert.equal(pageBody.includes('createBrowserGraphLayout(graph, focusId)'), true)
    assert.equal(pageBody.includes('neural-hidden-chip'), true)
    assert.equal(pageBody.includes('neural-edge-label'), true)
    assert.equal(pageBody.includes('NEURAL_OUTER_RING_LIMIT'), true)
    assert.match(pageBody, /event\.key === 'Escape'/)
    const focusIdAssignments = pageBody.match(/focusedNodeId = /g) || []
    assert.equal(focusIdAssignments.length >= 3, true)
    assert.equal(pageBody.includes('id="node-current-title"'), false) // was in neural cockpit HTML; moved to stub
    assert.equal(pageBody.includes('id="focus-hint"'), false) // was in neural cockpit HTML; moved to stub
    assert.equal(pageBody.includes('resetFocusToCenter'), true)
    assert.equal(pageBody.includes('點空白處或按 Esc 取消聚焦'), true)
    assert.equal(pageBody.includes("fetch('/api/graph', { cache: 'no-store' })"), true)

    const graph = await fetch(`${baseUrl}/api/graph`)
    assert.equal(graph.status, 200)
    const graphBody = await graph.json()
    assert.equal(graphBody.nodes.some((node: { type: string; title: string }) => node.type === 'double' && node.title === 'Kevin Autopilot'), true)
    assert.equal(graphBody.nodes.some((node: { type: string }) => node.type === 'project'), true)
    assert.equal(graphBody.nodes.some((node: { type: string }) => node.type === 'signal'), true)
    assert.equal(graphBody.edges.length > 0, true)

    const graphNode = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(graphBody.centerNodeId)}`)
    assert.equal(graphNode.status, 200)
    const graphNodeBody = await graphNode.json()
    assert.equal(graphNodeBody.node.thinking.understanding.includes('Kevin'), true)
    assert.equal(Array.isArray(graphNodeBody.node.thinking.questions), true)
    assert.equal(graphNodeBody.node.thinking.questions.length > 0, true)
    assert.equal(graphNodeBody.node.safety, 'read-only')
    assert.equal(graphNodeBody.node.actions.find((action: { id: string; enabled: boolean }) => action.id === 'copy-opencode-prompt')?.enabled, true)
    assert.match(graphNodeBody.node.prompt, /do not edit target repositories/i)

    const graphExtend = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(graphBody.centerNodeId)}/extend`, { method: 'POST' })
    assert.equal(graphExtend.status, 201)
    const graphExtendBody = await graphExtend.json()
    assert.equal(graphExtendBody.node.type, 'extension')
    assert.equal(JSON.stringify(graphExtendBody).includes('不是只看到更多泡泡'), true)

    const graphFind = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(graphBody.centerNodeId)}/find-relationships`, { method: 'POST' })
    assert.equal(graphFind.status, 201)
    const graphFindBody = await graphFind.json()
    assert.equal(graphFindBody.edges.some((edge: { source: string }) => edge.source === `relationship:${graphBody.centerNodeId}`), true)

    const graphMark = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(graphBody.centerNodeId)}/mark-interesting`, { method: 'POST' })
    assert.equal(graphMark.status, 201)
    const graphMarkBody = await graphMark.json()
    assert.equal(graphMarkBody.node.interesting, true)
    assert.equal(graphMarkBody.node.actions.find((action: { id: string; enabled: boolean }) => action.id === 'mark-interesting')?.enabled, false)

    const untrustedGraphAction = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(graphBody.centerNodeId)}/find-relationships`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    })
    assert.equal(untrustedGraphAction.status, 403)

    const projectNode = graphBody.nodes.find((node: { id: string; type: string }) => node.type === 'project')
    assert.ok(projectNode)
    const graphStop = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(projectNode.id)}/stop-exploring`, { method: 'POST' })
    assert.equal(graphStop.status, 201)
    assert.equal((await graphStop.json()).node.ignored, true)

    const backlog = await fetch(`${baseUrl}/api/backlog?status=active`)
    assert.equal(backlog.status, 200)
    const backlogBody = await backlog.json()
    assert.equal(backlogBody.counts.active, 1)
    assert.equal(backlogBody.counts.all, 1)
    assert.equal(backlogBody.items[0].id, 'repository-missing-repo-repeat-signal')
    assert.equal(backlogBody.items[0].seenCount, 2)
    assert.equal(backlogBody.items[0].strength, 'medium')
    assert.deepEqual(backlogBody.items[0].prevEvidence, ['first pass saw repository path missing'])

    const invalidSnooze = await fetch(`${baseUrl}/api/backlog/${encodeURIComponent(backlogBody.items[0].id)}/snooze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 2 }),
    })
    assert.equal(invalidSnooze.status, 400)
    assert.match(await invalidSnooze.text(), /1, 7, or 30/)

    const malformedSnooze = await fetch(`${baseUrl}/api/backlog/${encodeURIComponent(backlogBody.items[0].id)}/snooze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    assert.equal(malformedSnooze.status, 400)
    assert.match(await malformedSnooze.text(), /must be JSON/)

    const unknownDismiss = await fetch(`${baseUrl}/api/backlog/missing-id/dismiss`, { method: 'POST' })
    assert.equal(unknownDismiss.status, 404)

    const untrustedDismiss = await fetch(`${baseUrl}/api/backlog/${encodeURIComponent(backlogBody.items[0].id)}/dismiss`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    })
    assert.equal(untrustedDismiss.status, 403)

    const snooze = await fetch(`${baseUrl}/api/backlog/${encodeURIComponent(backlogBody.items[0].id)}/snooze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 1 }),
    })
    assert.equal(snooze.status, 200)
    const snoozeBody = await snooze.json()
    assert.equal(snoozeBody.status, 'snoozed')
    assert.equal(typeof snoozeBody.snoozedUntil, 'string')

    const afterSnooze = await fetch(`${baseUrl}/api/backlog?status=snoozed`)
    const afterSnoozeBody = await afterSnooze.json()
    assert.equal(afterSnoozeBody.counts.active, 0)
    assert.equal(afterSnoozeBody.counts.snoozed, 1)
    assert.equal(afterSnoozeBody.items.length, 1)

    const resolve = await fetch(`${baseUrl}/api/backlog/${encodeURIComponent(backlogBody.items[0].id)}/resolve`, { method: 'POST' })
    assert.equal(resolve.status, 200)
    assert.equal((await resolve.json()).status, 'resolved')

    const dismiss = await fetch(`${baseUrl}/api/backlog/${encodeURIComponent(backlogBody.items[0].id)}/dismiss`, { method: 'POST' })
    assert.equal(dismiss.status, 200)
    assert.equal((await dismiss.json()).status, 'dismissed')

    const loopStatus = await fetch(`${baseUrl}/api/observation-loop`)
    assert.equal(loopStatus.status, 200)
    const loopStatusBody = await loopStatus.json()
    assert.equal(loopStatusBody.enabled, false)
    assert.equal(loopStatusBody.mode, 'read-only-background-observation')

    const thinking = await fetch(`${baseUrl}/api/main-agent/thinking`)
    assert.equal(thinking.status, 200)
    const thinkingBody = await thinking.json()
    assert.equal(thinkingBody.mainAgent.mode, 'kevin-double-deterministic')
    assert.equal(typeof thinkingBody.mainAgent.qualityReview.score, 'number')
    assert.equal(thinkingBody.mainAgent.qualityReview.checks.length > 0, true)
    assert.equal(Array.isArray(thinkingBody.mainAgent.qualityReview.gaps), true)
    assert.equal(thinkingBody.projectRadar.some((project: { name: string; status: string }) => project.name === 'missing-repo' && project.status === 'needs_attention'), true)
    assert.equal(thinkingBody.candidates.length, 14)
    assert.equal(thinkingBody.candidates[0].id, 'repository-missing-repo-missing-repo')
    assert.equal(thinkingBody.candidates.findIndex((candidate: { id: string }) => candidate.id === 'service-broken-service-health-failed') > 0, true)
    assert.equal(thinkingBody.note, 'This is an auditable reasoning trace, not private chain-of-thought.')

    const settings = await fetch(`${baseUrl}/settings`)
    assert.equal(settings.status, 200)
    const settingsBody = await settings.text()
    assert.equal(settingsBody.includes('Autopilot Settings'), true)
    assert.equal(settingsBody.includes('data/autopilot.db'), true)
    assert.equal(settingsBody.includes('Runtime Overrides'), true)
    assert.equal(settingsBody.includes('data/runtime-overrides.json'), true)
    assert.equal(settingsBody.includes('aiReflection.enabled'), true)
    assert.equal(settingsBody.includes('key-admin-token'), false)

    const runtimeOverrides = await fetch(`${baseUrl}/api/runtime-overrides`)
    assert.equal(runtimeOverrides.status, 200)
    const runtimeOverridesBody = await runtimeOverrides.json()
    assert.deepEqual(runtimeOverridesBody.overrides, {})
    assert.equal(runtimeOverridesBody.schema['aiReflection.enabled'].type, 'boolean')

    const runtimeOverridePut = await fetch(`${baseUrl}/api/runtime-overrides`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aiReflection: { maxPendingAiIdeas: 12 } }),
    })
    assert.equal(runtimeOverridePut.status, 200)
    assert.equal((await runtimeOverridePut.json()).overrides.aiReflection.maxPendingAiIdeas, 12)

    const runtimeOverrideReset = await fetch(`${baseUrl}/api/runtime-overrides`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aiReflection: { maxPendingAiIdeas: null } }),
    })
    assert.equal(runtimeOverrideReset.status, 200)
    assert.equal((await runtimeOverrideReset.json()).overrides.aiReflection, undefined)

    const runtimeOverrideUnknown = await fetch(`${baseUrl}/api/runtime-overrides`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositories: [] }),
    })
    assert.equal(runtimeOverrideUnknown.status, 400)
    assert.match(await runtimeOverrideUnknown.text(), /repositories/)

    const runtimeOverrideUntrusted = await fetch(`${baseUrl}/api/runtime-overrides`, { headers: { 'x-forwarded-for': '8.8.8.8' } })
    assert.equal(runtimeOverrideUntrusted.status, 403)

    const runtimeOverridePutUntrusted = await fetch(`${baseUrl}/api/runtime-overrides`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '8.8.8.8' },
      body: JSON.stringify({ aiReflection: { enabled: true } }),
    })
    assert.equal(runtimeOverridePutUntrusted.status, 403)

    const idea = await fetch(`${baseUrl}/api/ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: '我要規格、開發和測試新工具' }),
    })
    assert.equal(idea.status, 201)
    const ideaBody = await idea.json()
    assert.equal(ideaBody.classification, 'plan')
    assert.equal(ideaBody.projectHandoff.mode, 'read-only-project-handoff')
    assert.equal(ideaBody.existingProjectAnalysis.recommendation, 'new-project')

    const pageAfterIdea = await fetch(`${baseUrl}/`)
    const pageAfterIdeaBody = await pageAfterIdea.text()
    // idea tab is now a stub; idea cards are no longer rendered inline in the page body
    assert.equal(pageAfterIdeaBody.includes('想法桌面：每個想法都是可進入的卡片'), false)
    assert.equal(pageAfterIdeaBody.includes(`href="/ideas/${ideaBody.id}"`), false)
    assert.equal(pageAfterIdeaBody.includes('分身狀態：'), false)
    assert.equal(pageAfterIdeaBody.includes('目前沒有明顯相似的既有專案'), false)

    const ideaDetail = await fetch(`${baseUrl}/ideas/${ideaBody.id}`)
    assert.equal(ideaDetail.status, 200)
    const ideaDetailBody = await ideaDetail.text()
    assert.equal(ideaDetailBody.includes('既有專案相似度'), true)
    assert.equal(ideaDetailBody.includes('分身目前在做什麼'), true)
    assert.equal(ideaDetailBody.includes('Handoff 狀態'), true)

    const missingIdeaDetail = await fetch(`${baseUrl}/ideas/idea-missing`)
    assert.equal(missingIdeaDetail.status, 404)

    const supplement = await fetch(`${baseUrl}/api/main-agent/supplements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: '下一輪先看 dashboard UX，不要碰部署。' }),
    })
    assert.equal(supplement.status, 201)
    const supplementBody = await supplement.json()
    assert.equal(supplementBody.appliesTo, 'next_observation')
    assert.equal(supplementBody.source, 'dashboard')

    const supplements = await fetch(`${baseUrl}/api/main-agent/supplements`)
    assert.equal(supplements.status, 200)
    const supplementsBody = await supplements.json()
    assert.equal(supplementsBody.length, 1)

    const badSupplement = await fetch(`${baseUrl}/api/main-agent/supplements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456' }),
    })
    assert.equal(badSupplement.status, 400)
    assert.match(await badSupplement.text(), /secret value/i)

    const report = await fetch(`${baseUrl}/api/report`)
    const reportBody = await report.json()
    assert.equal(reportBody.supplements.length, 1)
    assert.equal(reportBody.mainAgent.activeTask.supplementCount, 1)

    const keyImport = await fetch(`${baseUrl}/api/keys/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: `GEMINI_API_KEY=${GEMINI_KEY}` }),
    })
    assert.equal(keyImport.status, 201)
    const keyImportSummary = await keyImport.json()
    assert.equal(keyImportSummary.imported, 1)
    assert.deepEqual(keyImportSummary.status.storedSuffixes, ['...CCCC'])

    const keyStatus = await fetch(`${baseUrl}/api/keys/status`)
    assert.equal(keyStatus.status, 200)
    const keyStatusBody = await keyStatus.json()
    assert.equal(keyStatusBody.storedCount, 1)
    assert.ok(!JSON.stringify(keyStatusBody).includes(GEMINI_KEY))

    const keyClear = await fetch(`${baseUrl}/api/keys`, { method: 'DELETE' })
    assert.equal(keyClear.status, 200)
    assert.equal((await keyClear.json()).storedCount, 0)
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('graph action POST routes only mutate graph metadata', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-web-graph-scope-'))
  const targetRepo = join(dataDir, 'target-repo')
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [{ name: 'target-repo', path: targetRepo }],
    services: [],
  }
  const server = createWebServer(config)
  try {
    await mkdir(targetRepo, { recursive: true })
    await writeFile(join(targetRepo, 'sentinel.txt'), 'target repo must remain untouched\n', 'utf8')
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`

    const idea = await fetch(`${baseUrl}/api/ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: 'target repo agent cockpit prompt 關聯' }),
    })
    assert.equal(idea.status, 201)

    const graph = await fetch(`${baseUrl}/api/graph`)
    assert.equal(graph.status, 200)
    const graphBody = await graph.json()
    const ideaNode = graphBody.nodes.find((node: { id: string; type: string }) => node.type === 'idea')
    assert.ok(ideaNode)

    const before = await snapshotFiles(dataDir)
    for (const action of ['mark-interesting', 'find-relationships', 'stop-exploring']) {
      const response = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(ideaNode.id)}/${action}`, { method: 'POST' })
      assert.equal(response.status, 201)
    }
    const after = await snapshotFiles(dataDir)

    assert.deepEqual(changedFiles(before, after), ['idea-graph.json'])
    assert.equal(after.get('target-repo/sentinel.txt'), before.get('target-repo/sentinel.txt'))
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
})

test('GET /api/reflection/state returns never-run shape before any cycle', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-reflection-never-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    aiReflection: { maxPendingAiIdeas: 5 },
    ruleSources: [],
    repositories: [],
    services: [],
  }
  await saveRuntimeOverrides(config, { aiReflection: { maxPendingAiIdeas: 14 } })
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`
    const response = await fetch(`${baseUrl}/api/reflection/state`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.skipped, true)
    assert.equal(body.reason, 'never-run')
    assert.equal(body.pendingAiIdeaCount, 0)
    assert.equal(body.pendingAiIdeasCap, 14)
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('POST /api/ideas/:id/dismiss rejects user ideas and missing ids', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-dismiss-api-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`

    const created = await fetch(`${baseUrl}/api/ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: 'normal user idea about agent cockpit' }),
    })
    const userIdea = await created.json()

    const userDismiss = await fetch(`${baseUrl}/api/ideas/${encodeURIComponent(userIdea.id)}/dismiss`, { method: 'POST' })
    assert.equal(userDismiss.status, 400)

    const missing = await fetch(`${baseUrl}/api/ideas/idea-missing/dismiss`, { method: 'POST' })
    assert.equal(missing.status, 404)

    const untrusted = await fetch(`${baseUrl}/api/ideas/${encodeURIComponent(userIdea.id)}/dismiss`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    })
    assert.equal(untrusted.status, 403)
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('dashboard HTML uses cyberpunk CSS variables', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('--accent: #00ffff'), 'missing --accent CSS var')
  assert.ok(html.includes('--pink: #ff00ff'), 'missing --pink CSS var')
  assert.ok(html.includes("font-family: 'Courier New'"), 'missing monospace font')
})

test('dashboard HTML includes tab bar with four tabs', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('data-tab="brain"'), 'missing brain tab button')
  assert.ok(html.includes('data-tab="backlog"'), 'missing backlog tab button')
  assert.ok(html.includes('data-tab="graph"'), 'missing graph tab button')
  assert.ok(html.includes('data-tab="idea"'), 'missing idea tab button')
  assert.ok(html.includes('id="tab-brain"'), 'missing brain panel')
  assert.ok(html.includes('switchTab'), 'missing switchTab JS')
})

async function getDashboardHtml(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-dashhtml-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address !== 'object' || !('port' in address)) throw new Error('no address')
    const response = await fetch(`http://127.0.0.1:${address.port}/`)
    return response.text()
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
}

async function snapshotFiles(root: string, dir = root): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const [file, content] of await snapshotFiles(root, path)) snapshot.set(file, content)
      continue
    }
    if (!entry.isFile()) continue
    snapshot.set(relative(root, path).replace(/\\/g, '/'), await readFile(path, 'base64'))
  }
  return snapshot
}

function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const files = new Set([...before.keys(), ...after.keys()])
  return [...files].filter((file) => before.get(file) !== after.get(file)).sort()
}
