/**
 * settings-store.ts — generic key/value store for kevin-autopilot runtime
 * settings that the admin can change without restarting the container.
 *
 * Currently used for OpenCode configuration (URL + optional server password).
 * Persisted to the same SQLite database as the Gemini key store
 * (`${config.dataDir}/autopilot.db`) under a `kv_settings` table.
 *
 * Reads/writes are short-lived: the DB is opened, the query runs, then the
 * connection is closed. This matches the existing pattern in keys.ts.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { AutopilotConfig } from './types.js'

export type SettingKey =
  | 'opencode_servers'
  | 'opencode_text_model'
  | 'opencode_vision_model'
  | 'opencode_url' /* legacy, kept for back-compat with the v0.20.0 single-URL release */
  | 'opencode_server_password' /* legacy, kept for back-compat */

let writeQueue: Promise<unknown> = Promise.resolve()

function settingsDatabasePath(config: AutopilotConfig): string {
  return join(config.dataDir, 'autopilot.db')
}

function openSettingsDatabase(config: AutopilotConfig): DatabaseSync {
  const path = settingsDatabasePath(config)
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  return db
}

export function getSetting(config: AutopilotConfig, key: SettingKey): string | null {
  const db = openSettingsDatabase(config)
  try {
    const row = db.prepare('SELECT value FROM kv_settings WHERE key = ?').get(key) as { value?: string } | undefined
    const v = row?.value?.trim()
    return v && v.length > 0 ? v : null
  } finally {
    db.close()
  }
}

export async function setSetting(config: AutopilotConfig, key: SettingKey, value: string): Promise<void> {
  const transaction = writeQueue.then(() => {
    const db = openSettingsDatabase(config)
    try {
      const trimmed = value.trim()
      if (trimmed.length === 0) {
        db.prepare('DELETE FROM kv_settings WHERE key = ?').run(key)
      } else {
        db.prepare(
          `INSERT INTO kv_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        ).run(key, trimmed)
      }
    } finally {
      db.close()
    }
  })
  writeQueue = transaction.then(
    () => undefined,
    () => undefined,
  )
  return transaction
}

export function getAllSettings(config: AutopilotConfig): Record<string, string> {
  const db = openSettingsDatabase(config)
  try {
    const rows = db.prepare('SELECT key, value FROM kv_settings').all() as Array<{ key: string; value: string }>
    const result: Record<string, string> = {}
    for (const row of rows) result[row.key] = row.value
    return result
  } finally {
    db.close()
  }
}
