import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebServer, formatTaipeiTime, isTrustedSettingsAddress, isTrustedSettingsSource } from './web.js'
import type { AutopilotConfig } from './types.js'

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
    repositories: [{ name: 'missing-repo', path: join(dataDir, 'missing') }],
    services: [],
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
    assert.equal(pageBody.includes('今天只看這張'), true)
    assert.equal(pageBody.includes('現在重點：做這件'), true)
    assert.equal(pageBody.includes('唯一主要操作'), true)
    assert.equal(pageBody.includes('如果不對，只改這裡'), true)
    assert.equal(pageBody.includes('除錯/證據/完整清單，不用先看'), true)
    assert.equal(pageBody.includes('Kevin 子人格自問自答'), true)
    assert.equal(pageBody.includes('補充給下一輪'), true)
    assert.equal(pageBody.includes('Active Task'), true)
    assert.equal(pageBody.includes('Observation Backlog'), true)
    assert.equal(pageBody.includes('OpenCode prompt'), true)
    assert.equal(pageBody.includes('複製這個 Prompt'), true)

    const settings = await fetch(`${baseUrl}/settings`)
    assert.equal(settings.status, 200)
    const settingsBody = await settings.text()
    assert.equal(settingsBody.includes('Autopilot Settings'), true)
    assert.equal(settingsBody.includes('data/autopilot.db'), true)
    assert.equal(settingsBody.includes('key-admin-token'), false)

    const idea = await fetch(`${baseUrl}/api/ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: 'Plan repo architecture spec and tests' }),
    })
    assert.equal(idea.status, 201)
    const ideaBody = await idea.json()
    assert.equal(ideaBody.classification, 'plan')
    assert.equal(ideaBody.projectHandoff.mode, 'read-only-project-handoff')

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
