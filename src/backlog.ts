import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AutopilotConfig,
  BacklogItem,
  BacklogKind,
  BacklogMergeSummary,
  BacklogStatus,
  BacklogStatusFilter,
  BacklogStrength,
  ObservationCandidate,
} from './types.js'

const ONE_DAY_MS = 86400000
const ALLOWED_SNOOZE_DAYS = new Set([1, 7, 30])

export function ensureBacklogSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS backlog_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      prev_evidence_json TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      seen_count INTEGER NOT NULL,
      miss_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      snoozed_until TEXT,
      strength TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS backlog_items_status_idx ON backlog_items(status, last_seen_at DESC)`)
}

export function openBacklogDatabase(config: AutopilotConfig): DatabaseSync {
  const path = join(config.dataDir, 'autopilot.db')
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  ensureBacklogSchema(db)
  return db
}

export function deriveStrength(seen: number, miss: number): BacklogStrength {
  let level = seen >= 5 ? 2 : seen >= 2 ? 1 : 0
  if (miss >= 3) level = Math.max(0, level - 1)
  return level === 2 ? 'strong' : level === 1 ? 'medium' : 'weak'
}

export function getBacklogItem(db: DatabaseSync, id: string): BacklogItem | null {
  const row = db.prepare('SELECT * FROM backlog_items WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToItem(row) : null
}

export function mergeCandidatesIntoBacklog(
  db: DatabaseSync,
  candidates: ObservationCandidate[],
  now: Date,
): BacklogMergeSummary {
  const summary: BacklogMergeSummary = { inserted: 0, updated: 0, missed: 0, autoStaled: 0 }
  const nowIso = now.toISOString()
  const candidateMap = new Map(candidates.map((c) => [c.id, c]))
  const existingRows = db.prepare('SELECT * FROM backlog_items').all() as Record<string, unknown>[]
  const existingIds = new Set<string>()

  const updateHit = db.prepare(`
    UPDATE backlog_items SET
      prev_evidence_json = evidence_json,
      evidence_json = ?,
      last_seen_at = ?,
      seen_count = seen_count + 1,
      miss_count = 0,
      status = CASE WHEN status = 'resolved' THEN 'active' ELSE status END,
      strength = ?,
      updated_at = ?
    WHERE id = ?
  `)
  const updateMiss = db.prepare(`
    UPDATE backlog_items SET
      miss_count = miss_count + 1,
      status = CASE WHEN miss_count + 1 >= 6 THEN 'dismissed' ELSE status END,
      strength = ?,
      updated_at = ?
    WHERE id = ?
  `)
  const insert = db.prepare(`
    INSERT INTO backlog_items (
      id, kind, source_type, source_name, title, summary,
      evidence_json, prev_evidence_json, first_seen_at, last_seen_at,
      seen_count, miss_count, status, snoozed_until, strength, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 0, 'active', NULL, ?, ?)
  `)

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of existingRows) {
      const id = String(row.id)
      existingIds.add(id)
      const status = row.status as BacklogStatus
      const candidate = candidateMap.get(id)
      if (candidate) {
        if (status === 'dismissed') continue
        const newSeen = Number(row.seen_count) + 1
        updateHit.run(JSON.stringify(candidate.evidence), nowIso, deriveStrength(newSeen, 0), nowIso, id)
        summary.updated++
      } else {
        if (status === 'dismissed' || status === 'resolved') continue
        const newMiss = Number(row.miss_count) + 1
        const seen = Number(row.seen_count)
        updateMiss.run(deriveStrength(seen, newMiss), nowIso, id)
        summary.missed++
        if (newMiss >= 6) summary.autoStaled++
      }
    }

    for (const candidate of candidates) {
      if (existingIds.has(candidate.id)) continue
      insert.run(
        candidate.id,
        candidate.category as BacklogKind,
        candidate.sourceType,
        candidate.sourceName,
        candidate.title,
        candidate.actualBehavior,
        JSON.stringify(candidate.evidence),
        nowIso,
        nowIso,
        deriveStrength(1, 0),
        nowIso,
      )
      summary.inserted++
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return summary
}

export function listBacklog(db: DatabaseSync, filter: BacklogStatusFilter, now: Date): BacklogItem[] {
  const rows = db.prepare('SELECT * FROM backlog_items ORDER BY last_seen_at DESC').all() as Record<string, unknown>[]
  return rows
    .map(rowToItem)
    .filter((item) => filter === 'all' || effectiveStatus(item, now) === filter)
}

export function dismissBacklogItem(db: DatabaseSync, id: string, now: Date): BacklogItem | null {
  const result = db
    .prepare(`UPDATE backlog_items SET status = 'dismissed', snoozed_until = NULL, updated_at = ? WHERE id = ?`)
    .run(now.toISOString(), id)
  if (result.changes === 0) return null
  return getBacklogItem(db, id)
}

export function snoozeBacklogItem(db: DatabaseSync, id: string, days: number, now: Date): BacklogItem | null {
  if (!ALLOWED_SNOOZE_DAYS.has(days)) {
    throw new Error(`snooze days must be 1, 7, or 30; got ${days}`)
  }
  const until = new Date(now.getTime() + days * ONE_DAY_MS).toISOString()
  const result = db
    .prepare(`UPDATE backlog_items SET status = 'snoozed', snoozed_until = ?, updated_at = ? WHERE id = ?`)
    .run(until, now.toISOString(), id)
  if (result.changes === 0) return null
  return getBacklogItem(db, id)
}

export function resolveBacklogItem(db: DatabaseSync, id: string, now: Date): BacklogItem | null {
  const result = db
    .prepare(`UPDATE backlog_items SET status = 'resolved', snoozed_until = NULL, updated_at = ? WHERE id = ?`)
    .run(now.toISOString(), id)
  if (result.changes === 0) return null
  return getBacklogItem(db, id)
}

function rowToItem(row: Record<string, unknown>): BacklogItem {
  return {
    id: String(row.id),
    kind: row.kind as BacklogKind,
    sourceType: row.source_type as BacklogItem['sourceType'],
    sourceName: String(row.source_name),
    title: String(row.title),
    summary: String(row.summary),
    evidence: JSON.parse(String(row.evidence_json)) as string[],
    prevEvidence: row.prev_evidence_json ? (JSON.parse(String(row.prev_evidence_json)) as string[]) : null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    seenCount: Number(row.seen_count),
    missCount: Number(row.miss_count),
    status: row.status as BacklogStatus,
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : null,
    strength: row.strength as BacklogStrength,
    updatedAt: String(row.updated_at),
  }
}

export function effectiveStatus(item: BacklogItem, now: Date): BacklogStatus {
  const nowIso = now.toISOString()
  if (item.status === 'snoozed' && item.snoozedUntil && item.snoozedUntil <= nowIso) return 'active'
  return item.status
}
