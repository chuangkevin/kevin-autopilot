import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRadarDatabase, upsertRawSignal, listPendingSignals, markSignalProcessed, insertProblemCard, listProblemCards, makeSignalId, makeCardId } from './problem-cards.js'
import type { AutopilotConfig, ProblemCard, ProblemSignal } from './types.js'

function testConfig(dataDir: string): AutopilotConfig {
  return { environment: 'test', dataDir }
}

const testSignal = (): ProblemSignal => ({
  id: makeSignalId('hacker-news', 'hn:123', 'Test title'),
  sourceType: 'hacker-news',
  sourceName: 'hn:123',
  title: 'Test title',
  snippet: 'A real pain point about manual work',
  url: 'https://news.ycombinator.com/item?id=123',
  fetchedAt: new Date().toISOString(),
})

test('openRadarDatabase creates tables idempotently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-db-'))
  try {
    const db = openRadarDatabase(testConfig(dir))
    const db2 = openRadarDatabase(testConfig(dir)) // idempotent: second open MUST NOT throw
    // close both handles before rm — leaking the second handle holds a file
    // lock on Windows and makes the cleanup race against the lock release.
    db2.close()
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('upsertRawSignal inserts and deduplicates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-db-'))
  try {
    const db = openRadarDatabase(testConfig(dir))
    const signal = testSignal()
    upsertRawSignal(db, signal)
    upsertRawSignal(db, signal) // second insert should not throw
    const pending = listPendingSignals(db)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].id, signal.id)
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('markSignalProcessed updates status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-db-'))
  try {
    const db = openRadarDatabase(testConfig(dir))
    const signal = testSignal()
    upsertRawSignal(db, signal)
    markSignalProcessed(db, signal.id, 'done')
    const pending = listPendingSignals(db)
    assert.equal(pending.length, 0)
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('insertProblemCard and listProblemCards round-trip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-db-'))
  try {
    const db = openRadarDatabase(testConfig(dir))
    const signal = testSignal()
    const card: ProblemCard = {
      id: makeCardId(signal.id),
      signalId: signal.id,
      whoIsInPain: 'backend engineers',
      pain: '手動部署耗時',
      context: '團隊規模快速擴張時',
      currentWorkaround: '自己寫 rollback script',
      urgencySignal: '系統規模超過單人能管理的範圍',
      ideaSeeds: ['drift detection tool', 'auto rollback agent'],
      sourceUrl: signal.url,
      createdAt: new Date().toISOString(),
    }
    insertProblemCard(db, card)
    const cards = listProblemCards(db)
    assert.equal(cards.length, 1)
    assert.equal(cards[0].whoIsInPain, 'backend engineers')
    assert.deepEqual(cards[0].ideaSeeds, ['drift detection tool', 'auto rollback agent'])
    db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
