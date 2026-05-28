import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeSignalId, openRadarDatabase, listProblemCards, listPendingSignals } from './problem-cards.js'
import { runRadarPipeline, shouldRunScan } from './radar.js'
import type { AutopilotConfig, ProblemSignal } from './types.js'

function testConfig(dataDir: string): AutopilotConfig {
  return {
    environment: 'test',
    dataDir,
    ai: { enabled: true, provider: 'gemini', model: 'gemini-2.0-flash' },
  }
}

const signal: ProblemSignal = {
  id: makeSignalId('hacker-news', 'hn:1', 'Why is k8s so painful'),
  sourceType: 'hacker-news',
  sourceName: 'hn:1',
  title: 'Why is k8s so painful',
  snippet: 'I spend 3 hours every day manually fixing config drift. There has to be a better way. Our workaround is a bash script that we update by hand.',
  url: 'https://news.ycombinator.com/item?id=1',
  fetchedAt: new Date().toISOString(),
}

test('shouldRunScan: returns true when radarScan is absent (default enabled)', () => {
  assert.equal(shouldRunScan({ environment: 'test', dataDir: '/tmp' }), true)
})

test('shouldRunScan: returns true when radarScan.enabled is undefined', () => {
  assert.equal(shouldRunScan({ environment: 'test', dataDir: '/tmp', radarScan: {} }), true)
})

test('shouldRunScan: returns true when radarScan.enabled is true', () => {
  assert.equal(shouldRunScan({ environment: 'test', dataDir: '/tmp', radarScan: { enabled: true } }), true)
})

test('shouldRunScan: returns false only when radarScan.enabled is explicitly false', () => {
  assert.equal(shouldRunScan({ environment: 'test', dataDir: '/tmp', radarScan: { enabled: false } }), false)
})

test('runRadarPipeline: processes signals concurrently up to the concurrency cap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-pipe-'))
  try {
    const config = testConfig(dir)

    // Track in-flight calls to verify concurrency really kicks in.
    let inFlight = 0
    let peakInFlight = 0
    const fence = (obj: unknown) => '```json\n' + JSON.stringify(obj) + '\n```'
    const mockProvider = {
      generateContent: mock.fn(async ({ prompt }: { prompt: string }) => {
        inFlight++
        peakInFlight = Math.max(peakInFlight, inFlight)
        // Tiny delay so concurrent calls actually overlap.
        await new Promise((r) => setTimeout(r, 20))
        inFlight--
        if (prompt.includes('"keep":true')) return { text: fence({ keep: true }) }
        if (prompt.includes('who_is_in_pain')) {
          return { text: fence({ who_is_in_pain: 'g', pain: 'p', context: 'c', current_workaround: 'w', urgency_signal: 'u' }) }
        }
        return { text: fence(['a']) }
      }),
    }

    // 8 distinct signals so a concurrency cap of 3 must overlap ≥ 2.
    const signals: ProblemSignal[] = Array.from({ length: 8 }, (_, i) => ({
      id: makeSignalId('hacker-news', `hn:${i}`, `Signal ${i}`),
      sourceType: 'hacker-news',
      sourceName: `hn:${i}`,
      title: `Signal ${i}`,
      snippet: 'A real recurring workflow pain point that the AI keep classifier should accept.',
      url: `https://news.ycombinator.com/item?id=${i}`,
      fetchedAt: new Date().toISOString(),
    }))

    const db = openRadarDatabase(config)
    await runRadarPipeline(config, db, signals, mockProvider as never, { concurrency: 3 })
    db.close()

    assert.ok(peakInFlight >= 2, `peak in-flight should reflect concurrency (got ${peakInFlight})`)
    assert.ok(peakInFlight <= 3, `peak in-flight must not exceed cap (got ${peakInFlight})`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runRadarPipeline: AI disabled — signals stored, no cards created', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-pipe-'))
  try {
    const config: AutopilotConfig = { environment: 'test', dataDir: dir }
    const db = openRadarDatabase(config)
    await runRadarPipeline(config, db, [signal])
    const cards = listProblemCards(db)
    assert.equal(cards.length, 0)
    const pending = listPendingSignals(db)
    assert.equal(pending.length, 0) // skipped because AI disabled
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runRadarPipeline: AI enabled, provider mocked — card created', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-pipe-'))
  try {
    const config = testConfig(dir)

    const mockCard = {
      who_is_in_pain: 'DevOps engineers',
      pain: '手動修復配置漂移耗時',
      context: '大型 k8s 叢集快速擴展時',
      current_workaround: '手動維護 bash script',
      urgency_signal: '團隊規模超過單人可管理',
    }
    const mockSeeds = ['drift detection system', 'config audit tool']

    // Wrap every response in a ```json code fence — this is how
    // gemini-2.5-flash actually replies, and the pipeline must still parse it.
    const fence = (obj: unknown) => '```json\n' + JSON.stringify(obj) + '\n```'
    const mockProvider = {
      generateContent: mock.fn(async ({ prompt }: { prompt: string }) => {
        if (prompt.includes('{"keep":true}') || prompt.includes('"keep":true')) {
          return { text: fence({ keep: true }) }
        }
        if (prompt.includes('who_is_in_pain')) {
          return { text: fence(mockCard) }
        }
        return { text: fence(mockSeeds) }
      }),
    }

    const db = openRadarDatabase(config)
    await runRadarPipeline(config, db, [signal], mockProvider as never)
    const cards = listProblemCards(db)
    assert.equal(cards.length, 1)
    assert.equal(cards[0].whoIsInPain, 'DevOps engineers')
    assert.deepEqual(cards[0].ideaSeeds, mockSeeds)
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
