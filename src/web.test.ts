import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebServer, formatTaipeiTime, isTrustedSettingsAddress, isTrustedSettingsSource, renderBrainTab } from './web.js'
import { mergeCandidatesIntoBacklog, openBacklogDatabase } from './backlog.js'
import { saveRuntimeOverrides } from './runtime-overrides.js'
import { _setDeliberationRunning } from './deliberation.js'
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

test('dashboard shows a sanitized candidate problem pool', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-problem-pool-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`

    for (const rawText of [
      'Idea intake should plan repo architecture spec and tests. Plan repo architecture spec and tests for a safe idea handoff assistant before implementation.',
      '中古車業務每次刊登都要從 LINE 收照片，用 Excel 整理車輛規格，再截圖確認欄位，手動複製貼上到 8891 和 Facebook 很耗時。',
      '小型品牌創作者每週做短影音都要手動挑素材、截圖、命名和轉檔，在剪輯工具之間切換很耗時。',
    ]) {
      const created = await fetch(`${baseUrl}/api/ideas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText }),
      })
      assert.equal(created.status, 201)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }

    const page = await fetch(`${baseUrl}/`)
    assert.equal(page.status, 200)
    const pageBody = await page.text()
    assert.equal(pageBody.includes('候選問題池'), true)
    assert.equal(pageBody.includes('problem-candidate'), true)
    assert.equal(pageBody.includes('不是只看一個答案'), true)
    assert.equal(pageBody.includes('值得追'), true)
    assert.equal(pageBody.includes('先補證據'), true)
    assert.equal(pageBody.includes('validation-card'), true)
    assert.equal(pageBody.includes('有趣'), true)
    assert.equal(pageBody.includes('不是問題'), true)
    assert.equal(pageBody.includes('暫時不追 / 已排除訊號'), true)

    const dailyProblem = await fetch(`${baseUrl}/api/problem-discovery/daily`)
    assert.equal(dailyProblem.status, 200)
    const dailyProblemBody = await dailyProblem.json()
    assert.equal(Array.isArray(dailyProblemBody.candidates), true)
    assert.equal(dailyProblemBody.candidates.length >= 1, true)
    assert.equal('briefs' in dailyProblemBody, false)
    assert.equal('evaluations' in dailyProblemBody, false)
    assert.equal(Array.isArray(dailyProblemBody.rejectedSummary), true)
    assert.equal(dailyProblemBody.candidates.some((candidate: { evidence?: unknown }) => 'evidence' in candidate), false)
    assert.equal(dailyProblemBody.candidates.every((candidate: { evaluation?: { tier?: unknown; strongestEvidence?: string } }) => typeof candidate.evaluation?.tier === 'string'), true)
    assert.equal(JSON.stringify(dailyProblemBody.candidates).includes('full quotes stay out of the public daily API'), true)
    assert.equal(dailyProblemBody.brief && 'evidence' in dailyProblemBody.brief, false)
    assert.equal(JSON.stringify(dailyProblemBody.brief).includes('手動複製貼上到 8891 和 Facebook 很耗時'), false)
    assert.equal(JSON.stringify(dailyProblemBody.candidates).includes('safe idea handoff assistant'), false)

    const candidateId = dailyProblemBody.candidates[0].id
    const feedback = await fetch(`${baseUrl}/api/problem-discovery/${encodeURIComponent(candidateId)}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'interesting' }),
    })
    assert.equal(feedback.status, 201)
    const feedbackBody = await feedback.json()
    assert.equal(feedbackBody.feedback.source, 'trusted-dashboard')
    assert.equal(feedbackBody.evaluation.feedbackSummary.interesting, 1)

    const feedbackUntrusted = await fetch(`${baseUrl}/api/problem-discovery/${encodeURIComponent(candidateId)}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '8.8.8.8' },
      body: JSON.stringify({ action: 'boring' }),
    })
    assert.equal(feedbackUntrusted.status, 403)
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
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
    assert.equal(pageBody.includes('今日真實問題'), true)
    assert.equal(pageBody.includes('今天哪群人的哪個流程正在被爛工具、人工繞路、資訊混亂、平台限制拖累？'), true)
    assert.equal(pageBody.includes('id="tab-problem"'), true)
    assert.equal(pageBody.includes('id="tab-graph" hidden'), true)
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
    assert.equal(pageBody.includes('找更多關聯'), true) // still in embedded graph JSON (action labels)
    assert.equal(pageBody.includes('變成 OpenCode 任務'), true) // still in embedded graph JSON (action labels)
    assert.equal(pageBody.includes('標記有趣'), true) // still in embedded graph JSON (action labels)
    assert.equal(pageBody.includes('⚡ 多想一點'), true) // new primary action
    assert.equal(pageBody.includes('🧠 深度辯論'), true) // new primary action
    assert.equal(pageBody.includes('❄ 先不要想'), true) // new primary action (replaces 先不要想這條)
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
    assert.equal(pageBody.includes('候選問題池'), true) // daily problem tab still carries candidate-pool guidance when evidence is thin
    assert.equal(pageBody.includes('/api/main-agent/thinking'), false) // moved to stub
    assert.equal(pageBody.includes('分身現在在想'), false) // was in neural cockpit HTML; moved to stub
    assert.equal(pageBody.includes('💭 分身怎麼想這個'), true) // still in JS renderNodeDrawer (was: 我怎麼理解它 before v0.16.0)
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
    assert.equal(pageBody.includes('missing-repo'), true) // still in embedded graph JSON (node source/id)
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

    const dailyProblem = await fetch(`${baseUrl}/api/problem-discovery/daily`)
    assert.equal(dailyProblem.status, 200)
    const dailyProblemBody = await dailyProblem.json()
    assert.equal(typeof dailyProblemBody.pick.status, 'string')
    assert.equal(typeof dailyProblemBody.briefCount, 'number')
    assert.equal('briefs' in dailyProblemBody, false)

    const problemRun = await fetch(`${baseUrl}/api/problem-discovery/run`, { method: 'POST' })
    assert.equal(problemRun.status, 201)
    const problemRunBody = await problemRun.json()
    assert.equal(Array.isArray(problemRunBody.briefs), true)

    const problemRunUntrusted = await fetch(`${baseUrl}/api/problem-discovery/run`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    })
    assert.equal(problemRunUntrusted.status, 403)

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
    const graphArchive = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(projectNode.id)}/archive`, { method: 'POST' })
    assert.equal(graphArchive.status, 200)
    const archiveBody = await graphArchive.json()
    assert.equal(archiveBody.node.archived, true)
    assert.equal(typeof archiveBody.node.archivedAt, 'string')

    const untrustedArchive = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(projectNode.id)}/archive`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    })
    assert.equal(untrustedArchive.status, 403)

    const archivedList = await fetch(`${baseUrl}/api/idea/archived`)
    assert.equal(archivedList.status, 200)
    const archivedListBody = await archivedList.json()
    assert.equal(Array.isArray(archivedListBody), true)
    assert.equal(archivedListBody.some((node: { id: string }) => node.id === projectNode.id), true)

    const unarchive = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(projectNode.id)}/unarchive`, { method: 'POST' })
    assert.equal(unarchive.status, 200)
    const unarchiveBody = await unarchive.json()
    assert.equal(unarchiveBody.node.archived ?? false, false)

    const boostStatus = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(projectNode.id)}/boost-status`)
    assert.equal(boostStatus.status, 200)
    const boostStatusBody = await boostStatus.json()
    assert.equal(boostStatusBody.status, 'idle')
    assert.equal(typeof boostStatusBody.updatedAt, 'string')

    const deleted = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(projectNode.id)}`, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    assert.equal((await deleted.json()).deleted, true)

    const deletedAgain = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(projectNode.id)}`, { method: 'DELETE' })
    assert.equal(deletedAgain.status, 404)

    const centerArchive = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(graphBody.centerNodeId)}/archive`, { method: 'POST' })
    assert.equal(centerArchive.status, 400)
    const centerDelete = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(graphBody.centerNodeId)}`, { method: 'DELETE' })
    assert.equal(centerDelete.status, 400)

    const unknownBoost = await fetch(`${baseUrl}/api/idea/this-id-does-not-exist/boost`, { method: 'POST' })
    assert.equal(unknownBoost.status, 404)

    const anchoredDeliberateUnknown = await fetch(`${baseUrl}/api/deliberation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchorNodeId: 'no-such-anchor' }),
    })
    assert.equal(anchoredDeliberateUnknown.status, 400)
    assert.match((await anchoredDeliberateUnknown.json()).error, /unknown anchor/)

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
    assert.equal(pageAfterIdeaBody.includes('目前沒有明顯相似的既有專案'), true) // still in embedded graph JSON (idea node thinking.whyItMatters)

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

    const posGet = await fetch(`${baseUrl}/api/graph/positions`)
    assert.equal(posGet.status, 200)
    const posGetBody = await posGet.json()
    assert.deepEqual(posGetBody.positions, {})

    const posPut = await fetch(`${baseUrl}/api/graph/positions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions: { 'node-abc': { x: 120, y: 240 } } }),
    })
    assert.equal(posPut.status, 200)
    assert.equal((await posPut.json()).ok, true)

    const posGetAfter = await fetch(`${baseUrl}/api/graph/positions`)
    assert.deepEqual((await posGetAfter.json()).positions, { 'node-abc': { x: 120, y: 240 } })

    const posPutBad = await fetch(`${baseUrl}/api/graph/positions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions: 'not-an-object' }),
    })
    assert.equal(posPutBad.status, 400)
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
    for (const action of ['mark-interesting', 'find-relationships']) {
      const response = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(ideaNode.id)}/${action}`, { method: 'POST' })
      assert.equal(response.status, 201)
    }
    const archiveResponse = await fetch(`${baseUrl}/api/idea/${encodeURIComponent(ideaNode.id)}/archive`, { method: 'POST' })
    assert.equal(archiveResponse.status, 200)
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

test('dashboard HTML includes problem-first tab bar', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('data-tab="problem"'), 'missing problem tab button')
  assert.ok(html.includes('id="tab-problem"'), 'missing problem panel')
  assert.ok(html.includes('data-tab="brain"'), 'missing brain tab button')
  assert.ok(html.includes('data-tab="backlog"'), 'missing backlog tab button')
  assert.ok(html.includes('data-tab="graph"'), 'missing graph tab button')
  assert.ok(html.includes('data-tab="idea"'), 'missing idea tab button')
  assert.ok(html.includes('id="tab-brain"'), 'missing brain panel')
  assert.ok(html.includes('switchTab'), 'missing switchTab JS')
})

test('brain tab renders excited mode when excitementMode is excited', async () => {
  const html = renderBrainTab({
    mode: 'read-only-background-observation',
    enabled: true,
    intervalMs: 60_000,
    currentIntervalMs: 60_000,
    baseIntervalMs: 60_000,
    excitementMode: 'excited',
    lastExcitementScore: 2,
    running: false,
    runCount: 5,
  })
  assert.ok(html.includes('EXCITED'), 'missing EXCITED text')
  assert.ok(html.includes('brain-mode'), 'missing brain-mode class')
})

test('brain tab renders normal mode when excitementMode is normal', async () => {
  const html = renderBrainTab({
    mode: 'read-only-background-observation',
    enabled: true,
    intervalMs: 300_000,
    currentIntervalMs: 300_000,
    baseIntervalMs: 300_000,
    excitementMode: 'normal',
    lastExcitementScore: 0,
    running: false,
    runCount: 0,
  })
  assert.ok(html.includes('STANDBY'), 'missing STANDBY text')
})

test('backlog tab renders items with severity classes', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('id="tab-backlog"'), 'missing backlog panel')
  assert.ok(html.includes('bl-item'), 'missing bl-item class')
  assert.ok(html.includes('filter-pill'), 'missing filter pills')
})

test('graph tab renders Cytoscape container', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('id="tab-graph"'), 'missing graph panel')
  assert.ok(html.includes('class="cy-container"'), 'missing cy-container div')
  assert.ok(html.includes('cytoscape.min.js'), 'missing cytoscape CDN script')
  assert.ok(html.includes('refreshCyGraph'), 'missing refreshCyGraph function')
})

test('idea tab renders textarea and transmit button', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('id="tab-idea"'), 'missing idea panel')
  assert.ok(html.includes('class="idea-textarea"'), 'missing textarea')
  assert.ok(html.includes('TRANSMIT'), 'missing transmit button text')
})

test('GET /api/deliberation/latest returns idle with null when no record exists', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-deliberation-idle-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address !== 'object' || !('port' in address)) throw new Error('no address')
    const res = await fetch(`http://127.0.0.1:${address.port}/api/deliberation/latest`)
    assert.equal(res.status, 200)
    const body = await res.json() as { status: string; record: unknown }
    assert.equal(body.status, 'idle')
    assert.equal(body.record, null)
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('POST /api/deliberation from trusted source returns 202', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-deliberation-202-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address !== 'object' || !('port' in address)) throw new Error('no address')
    const res = await fetch(`http://127.0.0.1:${address.port}/api/deliberation`, { method: 'POST' })
    assert.equal(res.status, 202)
    const body = await res.json() as { status: string }
    assert.equal(body.status, 'started')
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('POST /api/deliberation from untrusted source returns 403', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-deliberation-403-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address !== 'object' || !('port' in address)) throw new Error('no address')
    const res = await fetch(`http://127.0.0.1:${address.port}/api/deliberation`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    })
    assert.equal(res.status, 403)
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('POST /api/deliberation returns 409 while deliberation is in flight', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-deliberation-409-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  _setDeliberationRunning(true)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address !== 'object' || !('port' in address)) throw new Error('no address')
    const res = await fetch(`http://127.0.0.1:${address.port}/api/deliberation`, { method: 'POST' })
    assert.equal(res.status, 409)
    const body = await res.json() as { status: string }
    assert.equal(body.status, 'already_running')
  } finally {
    _setDeliberationRunning(false)
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('GET /api/deliberation/latest returns running status while deliberation is in flight', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-deliberation-running-'))
  const config: AutopilotConfig = { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
  const server = createWebServer(config)
  _setDeliberationRunning(true)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address !== 'object' || !('port' in address)) throw new Error('no address')
    const res = await fetch(`http://127.0.0.1:${address.port}/api/deliberation/latest`)
    assert.equal(res.status, 200)
    const body = await res.json() as { status: string; record: unknown }
    assert.equal(body.status, 'running')
    assert.equal(body.record, null)
  } finally {
    _setDeliberationRunning(false)
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
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
