import { createServer } from 'node:http'
import type { AutopilotConfig } from './types.js'

export async function startWebServer(config: AutopilotConfig): Promise<void> {
  const port = Number(process.env.PORT ?? 3023)
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('World Problem Radar')
  })
  server.listen(port, () => console.log(`Radar on :${port} [${config.environment}]`))
  await new Promise<void>((resolve) => server.on('close', resolve))
}
