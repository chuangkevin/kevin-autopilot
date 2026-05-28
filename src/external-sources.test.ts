import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchHackerNewsSignals, fetchRedditSignals, fetchDcardSignals, fetchExternalSignals } from './external-sources.js'

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
    assert.ok(s.sourceName.startsWith('hn:'), `sourceName should start with hn: — got ${s.sourceName}`)
    assert.ok(s.url?.includes('news.ycombinator.com'), 'url should point to HN')
    assert.ok(s.snippet.length >= 80, 'snippet should be at least 80 chars')
    assert.ok(s.title.length > 0)
    assert.ok(typeof s.id === 'string' && s.id.length > 0)
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

test('fetchDcardSignals parses Dcard _api response and combines title + excerpt', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify([
    {
      id: 1234567,
      title: '勞健保自己保到底要付多少？跑了好幾個窗口都得到不同答案',
      excerpt: '從上週開始我為了搞清楚自己自費勞健保的計算方式跑了三個地方，每個櫃台講的金額都不一樣，有人說我要付這個級距、有人說那個級距、第三個直接告訴我官網查不到請我打電話，到底要相信誰，整個流程沒有一個清楚的對外說明',
    },
    { id: 7, title: '短', excerpt: '太短' },
  ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const signals = await fetchDcardSignals({ timeout: 5000 })
    assert.ok(signals.length >= 1, 'expected at least one signal')
    const s = signals[0]
    assert.equal(s.sourceType, 'dcard')
    assert.ok(s.sourceName.startsWith('dcard:'), `sourceName should start with dcard: — got ${s.sourceName}`)
    assert.ok(s.url?.includes('dcard.tw/f/'))
    assert.ok(s.snippet.length >= 80)
    assert.ok(s.snippet.includes(s.title), 'snippet should include title (combined text)')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchDcardSignals returns empty array on network failure', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network error') }
  try {
    const signals = await fetchDcardSignals({ timeout: 5000 })
    assert.deepEqual(signals, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchDcardSignals returns empty array when API returns non-200', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 403 })
  try {
    const signals = await fetchDcardSignals({ timeout: 5000 })
    assert.deepEqual(signals, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchExternalSignals combines HN + Reddit + Dcard results', async () => {
  const originalFetch = globalThis.fetch
  const calls = { hn: 0, reddit: 0, dcard: 0 }
  globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input)
    if (url.includes('hn.algolia.com')) {
      calls.hn++
      return new Response(JSON.stringify({ hits: [{ objectID: 'x1', title: 'Ask HN: broken workflow', story_text: 'I spend three hours daily doing repetitive manual work because the tools available do not support automation. The current workaround is error-prone scripting that breaks regularly and nobody wants to maintain.' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('dcard.tw')) {
      calls.dcard++
      return new Response(JSON.stringify([{ id: 42, title: '報稅程式每次都當機到底要怎麼搞', excerpt: '我每年到了報稅季都要花一整個下午跟那個老舊的網頁奮戰，今年它又當在送出最後一頁，已經第三次從頭重填整份資料，連客服都打不通，根本不知道是不是只有我這樣' }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    calls.reddit++
    return new Response(JSON.stringify({ data: { children: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const signals = await fetchExternalSignals({ timeout: 5000 })
    assert.ok(calls.hn > 0, 'HN should have been called')
    assert.ok(calls.reddit > 0, 'Reddit should have been called')
    assert.ok(calls.dcard > 0, 'Dcard should have been called')
    assert.ok(signals.some((s) => s.sourceType === 'hacker-news'), 'should have HN signals')
    assert.ok(signals.some((s) => s.sourceType === 'dcard'), 'should have Dcard signals')
  } finally {
    globalThis.fetch = originalFetch
  }
})
