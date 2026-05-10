import { loadConfig } from './config.js'
import { observe, writeReports } from './observer.js'
import { startWebServer } from './web.js'
import { APP_VERSION } from './version.js'

const DEFAULT_CONFIG_PATH = '/config/config.json'

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'observe'
  if (command === 'web') {
    const configPath = process.env.KEVIN_AUTOPILOT_CONFIG ?? DEFAULT_CONFIG_PATH
    const config = await loadConfig(configPath)
    await startWebServer(config)
    return
  }

  if (command !== 'observe') {
    throw new Error(`Unsupported command: ${command}`)
  }

  const configPath = process.env.KEVIN_AUTOPILOT_CONFIG ?? DEFAULT_CONFIG_PATH
  const config = await loadConfig(configPath)
  const report = await observe(config)
  const written = await writeReports(report, config.dataDir)

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        version: APP_VERSION,
        environment: report.environment,
        services: report.services.length,
        repositories: report.repositories.length,
        ruleSources: report.ruleSources.length,
        reports: written,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
