import { loadConfig } from './config.js'
import { startWebServer } from './web.js'
import { getEffectiveConfig } from './runtime-overrides.js'
import { fetchExternalSignals } from './external-sources.js'
import { openRadarDatabase } from './problem-cards.js'
import { runRadarPipeline, shouldRunScan } from './radar.js'
import { APP_VERSION } from './version.js'

const DEFAULT_CONFIG_PATH = '/config/config.json'
const DEFAULT_SCAN_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

async function runScan(configPath: string): Promise<void> {
  try {
    const baseConfig = await loadConfig(configPath)
    const config = await getEffectiveConfig(baseConfig)
    if (!shouldRunScan(config)) {
      console.log(`[radar] scan skipped — radarScan.enabled=false override`)
      return
    }
    console.log(`[radar] scan start — ${new Date().toISOString()}`)
    const signals = await fetchExternalSignals()
    console.log(`[radar] fetched ${signals.length} signals`)
    const db = openRadarDatabase(config)
    const cards = await runRadarPipeline(config, db, signals)
    db.close()
    console.log(`[radar] ${cards.length} new cards created`)
  } catch (err) {
    console.error('[radar] scan error:', err instanceof Error ? err.message : String(err))
  }
}

async function main(): Promise<void> {
  const configPath = process.env.KEVIN_AUTOPILOT_CONFIG ?? DEFAULT_CONFIG_PATH
  const config = await loadConfig(configPath)
  const effective = await getEffectiveConfig(config)

  console.log(`World Problem Radar v${APP_VERSION} [${config.environment}]`)

  const intervalMs = effective.radarScan?.intervalMs ?? DEFAULT_SCAN_INTERVAL_MS
  console.log(`[radar] background scan every ${intervalMs / 60_000} min`)

  // Initial scan on startup
  void runScan(configPath)

  // Recurring background scan
  setInterval(() => void runScan(configPath), intervalMs)

  // Start web server (blocks until server closes)
  await startWebServer(config)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
