import { loadConfig } from './config.js'
import { startWebServer } from './web.js'

const DEFAULT_CONFIG_PATH = '/config/config.json'

async function main(): Promise<void> {
  const configPath = process.env.KEVIN_AUTOPILOT_CONFIG ?? DEFAULT_CONFIG_PATH
  const config = await loadConfig(configPath)
  await startWebServer(config)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
