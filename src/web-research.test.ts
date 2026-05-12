import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshWebResearch } from './web-research.js'
import type { AutopilotConfig } from './types.js'

test('refreshWebResearch falls back to HTML search results when instant answer is empty', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kevin-autopilot-web-research-'))
  const originalFetch = globalThis.fetch
  const config: AutopilotConfig = {
    environment: 'test',
    dataDir,
    webResearch: { enabled: true, maxQueriesPerGraph: 1, cacheTtlMs: 60_000, timeoutMs: 1_000 },
    ruleSources: [],
    repositories: [],
    services: [],
  }
  try {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) return new Response(JSON.stringify({ RelatedTopics: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response('<html><a class="result__a" href="https://example.com/result">Useful agent cockpit result</a><div class="result__snippet">A real web result snippet.</div></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    }

    const findings = await refreshWebResearch(config, [{ id: 'idea-test', nodeId: 'idea-test', title: 'agent cockpit', keywords: ['agent', 'cockpit'] }])

    assert.equal(calls, 2)
    assert.equal(findings.length, 1)
    assert.equal(findings[0].sourceName, 'DuckDuckGo HTML Search')
    assert.equal(findings[0].title, 'Useful agent cockpit result')
    assert.equal(findings[0].summary, 'A real web result snippet.')
    assert.equal(findings[0].url, 'https://example.com/result')
  } finally {
    globalThis.fetch = originalFetch
    await rm(dataDir, { recursive: true, force: true })
  }
})
