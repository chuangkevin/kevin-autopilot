import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebServer, formatTaipeiTime, isTrustedSettingsAddress, isTrustedSettingsSource } from './web.js'
import { mergeCandidatesIntoBacklog, openBacklogDatabase } from './backlog.js'
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
    assert.equal(pageBody.includes('設定 Gemini Keys'), true)
    assert.equal(pageBody.includes('Kevin Autopilot Neural Cockpit'), true)
    assert.equal(pageBody.includes('Durable Backlog'), true)
    assert.equal(pageBody.includes('過去反覆看過的問題'), true)
    assert.equal(pageBody.includes('Missing repo keeps recurring'), true)
    assert.equal(pageBody.includes('seen 2'), true)
    assert.equal(pageBody.includes('上次留下的證據'), true)
    assert.equal(pageBody.includes('Snooze 7 天'), true)
    assert.equal(pageBody.includes('這裡不是重要性排名'), true)
    assert.equal(pageBody.includes('Priority Board'), false)
    assert.equal(pageBody.includes('找更多關聯'), true)
    assert.equal(pageBody.includes('變成 OpenCode 任務'), true)
    assert.equal(pageBody.includes('標記有趣'), true)
    assert.equal(pageBody.includes('先不要想這條'), true)
    assert.equal(pageBody.includes('打開分身的大腦'), true)
    assert.equal(pageBody.includes('像作夢一樣的半醒聯想'), true)
    assert.equal(pageBody.includes('brain-node'), true)
    assert.equal(pageBody.includes('node-drawer'), true)
    assert.equal(pageBody.includes('快速丟一段文字，不必整理格式'), true)
    assert.equal(pageBody.includes('目前背景觀察已關閉'), true)
    assert.equal(pageBody.includes('不會自己改 repo、commit、push、部署'), true)
    assert.equal(pageBody.includes('安全邊界：我可以做夢、聯想、觀察、整理、延伸、產生 prompt'), true)
    assert.equal(pageBody.includes('補充或修正分身這輪判斷'), true)
    assert.equal(pageBody.includes('Observation Workbench'), true)
    assert.equal(pageBody.includes('一次看多件，每件都保留位置'), true)
    assert.equal(pageBody.includes('建議模式：先補證據'), true)
    assert.equal(pageBody.includes('workbench-card'), true)
    assert.equal(pageBody.includes('分身思考過程'), true)
    assert.equal(pageBody.includes('我怎麼判斷下一步'), true)
    assert.equal(pageBody.includes('這不是模型私有 chain-of-thought'), true)
    assert.equal(pageBody.includes('像 Kevin 嗎？'), true)
    assert.equal(pageBody.includes('差在哪'), true)
    assert.equal(pageBody.includes('/100'), true)
    assert.equal(pageBody.includes('/api/main-agent/thinking'), true)
    assert.equal(pageBody.includes('分身現在在想'), true)
    assert.equal(pageBody.includes('我怎麼理解它'), true)
    assert.equal(pageBody.includes('修正這輪判斷'), true)
    assert.equal(pageBody.includes('除錯/證據/完整清單，不用先看'), true)
    assert.equal(pageBody.includes('Kevin 子人格自問自答'), true)
    assert.equal(pageBody.includes('修正下一輪判斷'), true)
    assert.equal(pageBody.includes('Active Task'), true)
    assert.equal(pageBody.includes('Observation Backlog'), true)
    assert.equal(pageBody.includes('OpenCode prompt'), true)
    assert.equal(pageBody.includes('複製 Prompt'), true)
    assert.equal(pageBody.includes('Project Radar'), true)
    assert.equal(pageBody.includes('所有專案都在雷達上'), true)
    assert.equal(pageBody.includes('不替你判斷哪個想法比較重要'), true)
    assert.equal(pageBody.includes('missing-repo'), true)

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
    assert.equal(graphNodeBody.node.safety, 'read-only')
    assert.equal(graphNodeBody.node.actions.find((action: { id: string; enabled: boolean }) => action.id === 'copy-opencode-prompt')?.enabled, true)
    assert.match(graphNodeBody.node.prompt, /do not edit target repositories/i)

    const graphExtend = await fetch(`${baseUrl}/api/graph/nodes/${encodeURIComponent(graphBody.centerNodeId)}/extend`, { method: 'POST' })
    assert.equal(graphExtend.status, 201)
    const graphExtendBody = await graphExtend.json()
    assert.equal(graphExtendBody.node.type, 'extension')
    assert.equal(JSON.stringify(graphExtendBody).includes('不代表已經查過網路') || JSON.stringify(graphExtendBody).includes('未宣稱已搜尋 public web'), true)

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
    assert.equal(settingsBody.includes('key-admin-token'), false)

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
    assert.equal(pageAfterIdeaBody.includes('想法桌面：每個想法都是可進入的卡片'), true)
    assert.equal(pageAfterIdeaBody.includes(`href="/ideas/${ideaBody.id}"`), true)
    assert.equal(pageAfterIdeaBody.includes('分身狀態：'), true)
    assert.equal(pageAfterIdeaBody.includes('目前沒有明顯相似的既有專案'), true)

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
