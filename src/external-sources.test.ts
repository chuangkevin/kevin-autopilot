import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchHackerNewsSignals } from './external-sources.js'

test('fetchHackerNewsSignals parses HN API response into ProblemSignals', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    hits: [
      {
        objectID: 'hn-42',
        title: 'Ask HN: How do you handle repetitive file renaming workflows?',
        story_text: 'I spend over three hours every week manually renaming and organizing exported files for clients. Every client has a different folder structure requirement and there is no tool that handles batch renaming with custom patterns. The current workaround is a fragile shell script that breaks whenever the export format changes.',
      },
      { objectID: 'hn-43', title: 'Short', story_text: 'too short' },
    ]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const signals = await fetchHackerNewsSignals({ timeout: 5000 })
    assert.ok(signals.length >= 1, 'expected at least one signal')
    const s = signals[0]
    assert.equal(s.sourceType, 'hacker-news')
    assert.ok(s.sourceName.startsWith('hacker-news:'), `sourceName should start with hacker-news: — got ${s.sourceName}`)
    assert.ok(s.url?.includes('news.ycombinator.com'), 'url should point to HN')
    assert.ok(s.snippet.length >= 80, 'snippet should be at least 80 chars')
    assert.ok(s.title.length > 0)
    assert.ok(typeof s.dedupKey === 'string' && s.dedupKey.length > 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchHackerNewsSignals returns empty array when fetch throws', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network error') }
  try {
    const signals = await fetchHackerNewsSignals({ timeout: 5000 })
    assert.deepEqual(signals, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchHackerNewsSignals returns empty array when API returns non-200', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 429 })
  try {
    const signals = await fetchHackerNewsSignals({ timeout: 5000 })
    assert.deepEqual(signals, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
