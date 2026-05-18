import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchHackerNewsSignals, fetchRedditSignals, fetchExternalSignals } from './external-sources.js'

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

test('fetchRedditSignals parses Reddit JSON API response', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      children: [
        { data: { id: 'r1', title: 'How do I automate my client invoicing?', selftext: 'I am spending hours every week manually creating invoices for each client. There must be a better way but I cannot find any tool that handles my specific edge cases. Currently I export data from a spreadsheet and copy-paste values into a PDF template which takes forever.', permalink: '/r/freelance/comments/r1/how_do_i_automate/' } },
        { data: { id: 'r2', title: 'Short', selftext: 'too short' } },
      ]
    }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const signals = await fetchRedditSignals({ timeout: 5000 })
    assert.ok(signals.length >= 1, 'expected at least one signal')
    const s = signals[0]
    assert.equal(s.sourceType, 'reddit')
    assert.ok(s.sourceName.startsWith('reddit:'), `sourceName should start with reddit: — got ${s.sourceName}`)
    assert.ok(s.url?.includes('reddit.com'))
    assert.ok(s.snippet.length >= 80)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchRedditSignals returns empty array on network failure', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network error') }
  try {
    const signals = await fetchRedditSignals({ timeout: 5000 })
    assert.deepEqual(signals, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchExternalSignals combines HN and Reddit results', async () => {
  const originalFetch = globalThis.fetch
  let callCount = 0
  globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    callCount++
    const url = String(input)
    if (url.includes('hn.algolia.com')) {
      return new Response(JSON.stringify({ hits: [{ objectID: 'x1', title: 'Ask HN: broken workflow', story_text: 'I spend three hours daily doing repetitive manual work because the tools available do not support automation. The current workaround is error-prone scripting that breaks regularly and nobody wants to maintain.' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ data: { children: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const signals = await fetchExternalSignals({ timeout: 5000 })
    assert.ok(callCount > 0, 'fetch should have been called')
    const hnSignals = signals.filter((s) => s.sourceType === 'hacker-news')
    assert.ok(hnSignals.length >= 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
