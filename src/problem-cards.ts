import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AutopilotConfig, ProblemCard, ProblemSignal } from './types.js'

const DB_FILE = 'radar.db'

export function makeSignalId(sourceType: string, sourceName: string, title: string): string {
  const hash = createHash('sha256')
    .update([sourceType, sourceName, title.slice(0, 120)].join('\x00'))
    .digest('hex')
    .slice(0, 12)
  return `sig-${hash}`
}

export function makeCardId(signalId: string): string {
  return `card-${signalId.slice(4)}`
}

export function openRadarDatabase(config: AutopilotConfig): DatabaseSync {
  mkdirSync(config.dataDir, { recursive: true })
  const db = new DatabaseSync(join(config.dataDir, DB_FILE))
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_signals (
      id          TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      title       TEXT NOT NULL,
      snippet     TEXT NOT NULL,
      url         TEXT,
      fetched_at  TEXT NOT NULL,
      processed   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS problem_cards (
      id                TEXT PRIMARY KEY,
      signal_id         TEXT NOT NULL,
      who_is_in_pain    TEXT NOT NULL,
      pain              TEXT NOT NULL,
      context           TEXT NOT NULL,
      current_workaround TEXT NOT NULL,
      urgency_signal    TEXT NOT NULL,
      idea_seeds        TEXT NOT NULL DEFAULT '[]',
      source_url        TEXT,
      created_at        TEXT NOT NULL
    );
  `)
  return db
}

export function upsertRawSignal(db: DatabaseSync, signal: ProblemSignal): void {
  db.prepare(`
    INSERT OR IGNORE INTO raw_signals (id, source_type, source_name, title, snippet, url, fetched_at, processed)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(signal.id, signal.sourceType, signal.sourceName, signal.title, signal.snippet, signal.url ?? null, signal.fetchedAt)
}

export function listPendingSignals(db: DatabaseSync): ProblemSignal[] {
  const rows = db.prepare(`
    SELECT id, source_type, source_name, title, snippet, url, fetched_at
    FROM raw_signals WHERE processed = 0 ORDER BY fetched_at ASC
  `).all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id),
    sourceType: String(r.source_type) as ProblemSignal['sourceType'],
    sourceName: String(r.source_name),
    title: String(r.title),
    snippet: String(r.snippet),
    url: r.url ? String(r.url) : undefined,
    fetchedAt: String(r.fetched_at),
  }))
}

export function markSignalProcessed(db: DatabaseSync, id: string, status: 'done' | 'skipped'): void {
  db.prepare(`UPDATE raw_signals SET processed = ? WHERE id = ?`).run(status === 'done' ? 1 : 2, id)
}

export function insertProblemCard(db: DatabaseSync, card: ProblemCard): void {
  db.prepare(`
    INSERT OR REPLACE INTO problem_cards
      (id, signal_id, who_is_in_pain, pain, context, current_workaround, urgency_signal, idea_seeds, source_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    card.id, card.signalId, card.whoIsInPain, card.pain, card.context,
    card.currentWorkaround, card.urgencySignal, JSON.stringify(card.ideaSeeds),
    card.sourceUrl ?? null, card.createdAt,
  )
}

export function listProblemCards(db: DatabaseSync, options: { limit?: number; offset?: number } = {}): ProblemCard[] {
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0
  const rows = db.prepare(`
    SELECT id, signal_id, who_is_in_pain, pain, context, current_workaround,
           urgency_signal, idea_seeds, source_url, created_at
    FROM problem_cards ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id),
    signalId: String(r.signal_id),
    whoIsInPain: String(r.who_is_in_pain),
    pain: String(r.pain),
    context: String(r.context),
    currentWorkaround: String(r.current_workaround),
    urgencySignal: String(r.urgency_signal),
    ideaSeeds: JSON.parse(String(r.idea_seeds)) as string[],
    sourceUrl: r.source_url ? String(r.source_url) : undefined,
    createdAt: String(r.created_at),
  }))
}
