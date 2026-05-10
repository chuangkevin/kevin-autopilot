import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebServer } from './web.js'
import type { AutopilotConfig } from './types.js'

test('web server exposes health and idea intake', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-web-'))
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    ruleSources: [],
    repositories: [],
    services: [],
  }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const baseUrl = `http://127.0.0.1:${address.port}`

    const health = await fetch(`${baseUrl}/health`)
    assert.equal(health.status, 200)
    assert.equal((await health.json()).environment, 'test')

    const idea = await fetch(`${baseUrl}/api/ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: 'Plan repo architecture spec and tests' }),
    })
    assert.equal(idea.status, 201)
    assert.equal((await idea.json()).classification, 'plan')
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
