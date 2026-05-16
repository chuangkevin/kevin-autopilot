import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProblemBriefs,
  createProblemSignal,
  generateDailyProblemPick,
  getDailyProblemDiscovery,
  listProblemSignals,
  upsertProblemSignals,
} from './problem-discovery.js'
import type { AutopilotConfig } from './types.js'

function testConfig(dataDir: string): AutopilotConfig {
  return { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
}

test('problem signal persistence deduplicates and skips malformed stored data', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-problems-'))
  try {
    const config = testConfig(dataDir)
    const dir = join(dataDir, 'problem-signals')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'bad.json'), '{not json', 'utf8')
    const signal = createProblemSignal({
      sourceType: 'kevin-input',
      sourceName: 'test',
      title: '中古車業務每次都用 Excel 和 LINE 整理刊登資料',
      snippet: '中古車業務每次都用 Excel 和 LINE 整理車輛照片、規格和刊登欄位，人工複製貼上很容易漏。',
      fetchedAt: '2026-05-15T00:00:00.000Z',
    })
    await upsertProblemSignals(config, [signal, signal])
    const stored = await listProblemSignals(config)
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.id, signal.id)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('problem extraction rejects tech-only trends', () => {
  const signal = createProblemSignal({
    sourceType: 'forum',
    sourceName: 'public-test',
    title: 'GPT-5 model protocol vector DB framework trend',
    snippet: 'GPT-5 model protocol vector DB framework trend is the next AI agent startup category.',
    fetchedAt: '2026-05-15T00:00:00.000Z',
  })
  assert.equal(buildProblemBriefs([signal]).length, 0)
})

test('problem extraction rejects internal repo architecture spec and tests', () => {
  const signal = createProblemSignal({
    sourceType: 'kevin-input',
    sourceName: 'internal-plan',
    title: 'Idea intake should plan repo architecture spec and tests',
    snippet: 'Plan repo architecture spec and tests for a safe idea handoff assistant before implementation.',
    fetchedAt: '2026-05-15T00:00:00.000Z',
  })
  assert.equal(buildProblemBriefs([signal]).length, 0)
})

test('problem extraction keeps real PM design prototype workflow', () => {
  const signal = createProblemSignal({
    sourceType: 'kevin-input',
    sourceName: 'pm-workflow',
    title: 'PM 用截圖和 Figma 對齊需求太慢',
    snippet: 'PM 每次把客戶需求、截圖和 Figma 註解整理給設計師與工程師，靠文件來回手動對齊 prototype，重複又耗時。',
    fetchedAt: '2026-05-15T00:00:00.000Z',
  })
  const briefs = buildProblemBriefs([signal])
  assert.equal(briefs.length, 1)
  assert.equal(briefs[0]?.dedupKey, 'pm-spec-to-prototype')
})

test('problem extraction accepts Excel LINE screenshot manual workaround', () => {
  const signal = createProblemSignal({
    sourceType: 'kevin-input',
    sourceName: 'fixture',
    title: '車商照片刊登流程卡在手動整理',
    snippet: '中古車業務每次刊登都要從 LINE 收照片，用 Excel 整理車輛規格，再截圖確認欄位，手動複製貼上到 8891 和 Facebook 很耗時。',
    fetchedAt: '2026-05-15T00:00:00.000Z',
  })
  const briefs = buildProblemBriefs([signal])
  assert.equal(briefs.length, 1)
  assert.match(briefs[0]?.people ?? '', /車商|中古車/)
  assert.match(briefs[0]?.workaround ?? '', /Excel|LINE|截圖/)
  assert.equal(briefs[0]?.kevinFit.relatedProjects.includes('sheet-to-car'), true)
})

test('problem extraction accepts calm PKM digital overwhelm workflow', () => {
  const signal = createProblemSignal({
    sourceType: 'kevin-input',
    sourceName: 'calm-pkm',
    title: '仿生人格作為減輕螢幕焦慮的助手',
    snippet: '探索仿生人格如何以 calm computing 裝置的形式存在，成為無螢幕、減少數位干擾的個人知識管理或生活助手，整合筆記軟體、檔案系統與專案管理工具。',
    fetchedAt: '2026-05-15T00:00:00.000Z',
  })
  const briefs = buildProblemBriefs([signal])
  assert.equal(briefs.length, 1)
  assert.equal(briefs[0]?.dedupKey, 'calm-personal-knowledge')
  assert.equal(briefs[0]?.kevinFit.relatedProjects.includes('mind-diary'), true)
})

test('daily pick candidates ignore boring internal engineering signals', () => {
  const internal = createProblemSignal({
    sourceType: 'kevin-input',
    sourceName: 'internal-plan',
    title: 'Idea intake should plan repo architecture spec and tests',
    snippet: 'Plan repo architecture spec and tests for a safe idea handoff assistant before implementation.',
    fetchedAt: '2026-05-15T00:00:00.000Z',
  })
  const car = createProblemSignal({
    sourceType: 'kevin-input',
    sourceName: 'car-workflow',
    title: '車商照片刊登流程卡在手動整理',
    snippet: '中古車業務每次刊登都要從 LINE 收照片，用 Excel 整理車輛規格，再截圖確認欄位，手動複製貼上到 8891 和 Facebook 很耗時。',
    fetchedAt: '2026-05-15T00:00:00.000Z',
  })
  const briefs = buildProblemBriefs([internal, car])
  const pick = generateDailyProblemPick('2026-05-16', briefs)
  assert.equal(briefs.length, 1)
  assert.match(briefs[0]?.title ?? '', /車商/)
  assert.equal(pick.briefId, briefs[0]?.id)
})

test('daily pick returns insufficient evidence when no brief is strong enough', () => {
  const pick = generateDailyProblemPick('2026-05-16', [])
  assert.equal(pick.status, 'insufficient-evidence')
  assert.equal(pick.briefId, undefined)
  assert.ok(pick.missingEvidence.length > 0)
})

test('daily pick is stable for the same Taipei date unless forced', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-daily-problem-'))
  try {
    const config = testConfig(dataDir)
    await upsertProblemSignals(config, [createProblemSignal({
      sourceType: 'kevin-input',
      sourceName: 'first',
      title: 'PM 用截圖和文件來回轉需求',
      snippet: 'PM 每次都用截圖和文件描述需求，設計和工程靠手動對齊 prototype，來回很多次。',
      fetchedAt: '2026-05-15T16:10:00.000Z',
    })])
    const first = await getDailyProblemDiscovery(config, { force: true, now: new Date('2026-05-15T16:10:00.000Z') })
    await upsertProblemSignals(config, [createProblemSignal({
      sourceType: 'kevin-input',
      sourceName: 'second',
      title: '中古車業務 Excel LINE 刊登流程',
      snippet: '中古車業務每次刊登都靠 Excel、LINE、截圖和手動複製貼上整理車輛資料，重複又容易漏。',
      fetchedAt: '2026-05-15T17:00:00.000Z',
    })])
    const sameDay = await getDailyProblemDiscovery(config, { now: new Date('2026-05-15T23:30:00.000Z') })
    const nextDay = await getDailyProblemDiscovery(config, { now: new Date('2026-05-16T16:30:00.000Z') })
    assert.equal(first.pick.date, '2026-05-16')
    assert.equal(sameDay.pick.briefId, first.pick.briefId)
    assert.equal((await listProblemSignals(config)).length, 2)
    assert.equal(sameDay.briefs.length >= first.briefs.length, true)
    assert.equal(nextDay.pick.date, '2026-05-17')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('daily pick regenerates when same-day stored brief was retired', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-stale-daily-problem-'))
  try {
    const config = testConfig(dataDir)
    await writeFile(join(dataDir, 'daily-problem-pick.json'), `${JSON.stringify({
      date: '2026-05-16',
      status: 'picked',
      generatedAt: '2026-05-15T16:00:00.000Z',
      briefId: 'problem-retired-internal-spec',
      whyThis: 'old classifier pick',
      whyNotOthers: [],
      missingEvidence: [],
    }, null, 2)}\n`, 'utf8')
    await upsertProblemSignals(config, [createProblemSignal({
      sourceType: 'kevin-input',
      sourceName: 'car-workflow',
      title: '車商照片刊登流程卡在手動整理',
      snippet: '中古車業務每次刊登都要從 LINE 收照片，用 Excel 整理車輛規格，再截圖確認欄位，手動複製貼上到 8891 和 Facebook 很耗時。',
      fetchedAt: '2026-05-15T17:00:00.000Z',
    })])
    const discovery = await getDailyProblemDiscovery(config, { now: new Date('2026-05-15T23:30:00.000Z') })
    assert.equal(discovery.pick.status, 'picked')
    assert.notEqual(discovery.pick.briefId, 'problem-retired-internal-spec')
    assert.match(discovery.brief?.title ?? '', /車商/)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
