import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createWebServer } from './web.js'
import type { AutopilotConfig } from './types.js'

test('GET / returns feed page', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'radar-web-'))
  const config: AutopilotConfig = { environment: 'test', dataDir }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const base = `http://127.0.0.1:${address.port}`

    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0')
    const body = await res.text()
    assert.ok(body.includes('WORLD PROBLEM RADAR'))
    assert.ok(body.includes('PROBLEM FEED'))
    assert.ok(body.includes('paste-input'))
    assert.ok(body.includes('Scan Now'))
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('GET /health returns JSON', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'radar-web-'))
  const config: AutopilotConfig = { environment: 'test', dataDir }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const res = await fetch(`http://127.0.0.1:${address.port}/health`)
    assert.equal(res.status, 200)
    const body = await res.json() as { environment: string }
    assert.equal(body.environment, 'test')
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('GET /api/radar/cards returns JSON array', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'radar-web-'))
  const config: AutopilotConfig = { environment: 'test', dataDir }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const res = await fetch(`http://127.0.0.1:${address.port}/api/radar/cards`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body))
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('POST /api/radar/paste ingest manual signal', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'radar-web-'))
  const config: AutopilotConfig = { environment: 'test', dataDir }
  const server = createWebServer(config)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const base = `http://127.0.0.1:${address.port}`
    const res = await fetch(`${base}/api/radar/paste`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '每次 deploy 都要手動改設定，浪費很多時間' }),
    })
    assert.equal(res.status, 202)
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
