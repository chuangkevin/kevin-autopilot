import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  deriveStrength,
  ensureBacklogSchema,
  mergeCandidatesIntoBacklog,
  listBacklog,
  getBacklogItem,
  dismissBacklogItem,
  snoozeBacklogItem,
  resolveBacklogItem,
} from './backlog.js'
import type { ObservationCandidate } from './types.js'

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  ensureBacklogSchema(db)
  return db
}

function makeCandidate(overrides: Partial<ObservationCandidate> = {}): ObservationCandidate {
  return {
    id: 'repository-kevin-autopilot-dirty-worktree',
    category: 'improvement_candidate',
    confidence: 'suspected',
    title: 'kevin-autopilot has uncommitted work',
    sourceType: 'repository',
    sourceName: 'kevin-autopilot',
    evidence: ['16 modified files', '0 untracked files'],
    expectedBehavior: 'Clean working tree',
    actualBehavior: 'Working tree has uncommitted edits',
    suggestedNextStep: 'Review the diff and decide whether to commit or revert',
    approvalRequired: false,
    risk: 'low',
    boundedPrompt: '...',
    ...overrides,
  }
}

const NOW1 = new Date('2026-05-12T00:00:00Z')
const NOW2 = new Date('2026-05-13T00:00:00Z')

test('deriveStrength: 1 seen / 0 miss => weak', () => {
  assert.equal(deriveStrength(1, 0), 'weak')
})

test('deriveStrength: 2 seen / 0 miss => medium', () => {
  assert.equal(deriveStrength(2, 0), 'medium')
})

test('deriveStrength: 5 seen / 0 miss => strong', () => {
  assert.equal(deriveStrength(5, 0), 'strong')
})

test('deriveStrength: miss_count >= 3 drops one level', () => {
  assert.equal(deriveStrength(5, 3), 'medium')
  assert.equal(deriveStrength(2, 3), 'weak')
  assert.equal(deriveStrength(1, 3), 'weak') // weak already at floor
})

test('ensureBacklogSchema is idempotent', () => {
  const db = new DatabaseSync(':memory:')
  ensureBacklogSchema(db)
  ensureBacklogSchema(db)
  const rows = db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').all('table', 'backlog_items')
  assert.equal(rows.length, 1)
  db.close()
})

test('first observation cycle inserts active row with seen_count=1', () => {
  const db = freshDb()
  const summary = mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  assert.equal(summary.inserted, 1)
  assert.equal(summary.updated, 0)
  const item = getBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree')
  assert.ok(item)
  assert.equal(item.status, 'active')
  assert.equal(item.seenCount, 1)
  assert.equal(item.missCount, 0)
  assert.equal(item.strength, 'weak')
  assert.equal(item.firstSeenAt, NOW1.toISOString())
  assert.equal(item.lastSeenAt, NOW1.toISOString())
  assert.equal(item.prevEvidence, null)
  db.close()
})

test('second cycle with same candidate increments seen_count and stores prev evidence', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate({ evidence: ['cycle1-evidence'] })], NOW1)
  const summary = mergeCandidatesIntoBacklog(db, [makeCandidate({ evidence: ['cycle2-evidence'] })], NOW2)
  assert.equal(summary.updated, 1)
  assert.equal(summary.inserted, 0)
  const item = getBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree')!
  assert.equal(item.seenCount, 2)
  assert.equal(item.strength, 'medium')
  assert.deepEqual(item.evidence, ['cycle2-evidence'])
  assert.deepEqual(item.prevEvidence, ['cycle1-evidence'])
  db.close()
})

test('missing candidate increments miss_count', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  const summary = mergeCandidatesIntoBacklog(db, [], NOW2)
  assert.equal(summary.missed, 1)
  const item = getBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree')!
  assert.equal(item.missCount, 1)
  assert.equal(item.seenCount, 1)
  db.close()
})

test('miss_count of 3 drops strength one level', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1) // seenCount=2 medium
  for (let i = 0; i < 3; i++) {
    mergeCandidatesIntoBacklog(db, [], new Date(NOW2.getTime() + i * 86400000))
  }
  const item = getBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree')!
  assert.equal(item.missCount, 3)
  assert.equal(item.strength, 'weak')
  db.close()
})

test('miss_count of 6 auto-stales row to dismissed', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  for (let i = 0; i < 6; i++) {
    mergeCandidatesIntoBacklog(db, [], new Date(NOW2.getTime() + i * 86400000))
  }
  const item = getBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree')!
  assert.equal(item.status, 'dismissed')
  db.close()
})

test('dismissed row stays dismissed when re-observed', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  dismissBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree', NOW1)
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW2)
  const item = getBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree')!
  assert.equal(item.status, 'dismissed')
  assert.equal(item.seenCount, 1) // not incremented for dismissed rows
  db.close()
})

test('resolved row revives to active on recurrence', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  resolveBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree', NOW1)
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW2)
  const item = getBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree')!
  assert.equal(item.status, 'active')
  assert.equal(item.seenCount, 2)
  assert.equal(item.missCount, 0)
  db.close()
})

test('active snooze keeps status on recurrence but updates seen_count', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  snoozeBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree', 7, NOW1)
  const sameDay = new Date(NOW1.getTime() + 86400000) // 1 day later, still snoozed
  mergeCandidatesIntoBacklog(db, [makeCandidate()], sameDay)
  const item = getBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree')!
  assert.equal(item.status, 'snoozed')
  assert.equal(item.seenCount, 2)
  assert.equal(item.missCount, 0)
  db.close()
})

test('listBacklog returns expired snoozes in active filter', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  snoozeBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree', 1, NOW1)
  const tenDaysLater = new Date(NOW1.getTime() + 10 * 86400000)
  const active = listBacklog(db, 'active', tenDaysLater)
  const snoozed = listBacklog(db, 'snoozed', tenDaysLater)
  assert.equal(active.length, 1)
  assert.equal(snoozed.length, 0)
  db.close()
})

test('listBacklog status=all returns every status', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate({ id: 'a-1' }), makeCandidate({ id: 'a-2' })], NOW1)
  dismissBacklogItem(db, 'a-1', NOW1)
  assert.equal(listBacklog(db, 'all', NOW1).length, 2)
  assert.equal(listBacklog(db, 'active', NOW1).length, 1)
  assert.equal(listBacklog(db, 'dismissed', NOW1).length, 1)
  db.close()
})

test('snoozeBacklogItem rejects invalid days', () => {
  const db = freshDb()
  mergeCandidatesIntoBacklog(db, [makeCandidate()], NOW1)
  assert.throws(() => snoozeBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree', 2, NOW1))
  assert.throws(() => snoozeBacklogItem(db, 'repository-kevin-autopilot-dirty-worktree', 0, NOW1))
  db.close()
})

test('action functions return null for unknown id', () => {
  const db = freshDb()
  assert.equal(dismissBacklogItem(db, 'nope', NOW1), null)
  assert.equal(snoozeBacklogItem(db, 'nope', 7, NOW1), null)
  assert.equal(resolveBacklogItem(db, 'nope', NOW1), null)
  db.close()
})
