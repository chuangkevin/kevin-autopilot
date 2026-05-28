import { makeSignalId } from './problem-cards.js'
import type { ProblemSignal } from './types.js'

const HN_BASE = 'https://hn.algolia.com/api/v1/search'
const HN_TAGS: Array<'show_hn' | 'ask_hn'> = ['show_hn', 'ask_hn']

// Reddit: tech + non-tech everyday-life pain subs. The non-tech ones (added
// 2026-05-28) exist to balance the radar away from "engineers complain about
// engineering tools" toward general human workflow pain.
const REDDIT_SUBREDDITS = [
  // tech / founder
  'programming', 'ExperiencedDevs', 'SaaS', 'startups',
  // everyday-life pain
  'personalfinance',  // taxes, bills, insurance paperwork
  'smallbusiness',    // non-tech owner ops pain
  'Teachers',         // classroom workflow pain
  'Frugal',           // cost-driven workarounds (workaround = pain proxy)
  'LifeProTips',      // workarounds (same — every LPT implies a pain it solved)
]
const REDDIT_AGENT = 'world-problem-radar/1.0 (personal research tool)'

// Dcard: Taiwan-primary source added 2026-05-28. Slugs are Dcard's URL aliases
// — if any are wrong, the per-forum `if (!res.ok) continue` makes them
// silently no-op rather than crash the scan. Skews toward non-tech everyday
// Taiwanese life pain (workplace, finance, daily logistics, pets, food).
const DCARD_FORUMS = ['job', 'mood', 'money', 'relationship', 'marriage', 'pet', 'food']
const DCARD_AGENT = REDDIT_AGENT

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\s+/g, ' ').trim()
}

export async function fetchHackerNewsSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const timeout = options.timeout ?? 10_000
  const signals: ProblemSignal[] = []
  const fetchedAt = new Date().toISOString()
  for (const tag of HN_TAGS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const res = await fetch(`${HN_BASE}?tags=${tag}&hitsPerPage=30`, { signal: ctrl.signal })
        if (!res.ok) continue
        const data = await res.json() as { hits?: unknown[] }
        for (const hit of data.hits ?? []) {
          const h = hit as Record<string, unknown>
          const text = stripHtml([String(h.story_text ?? ''), String(h.comment_text ?? '')].filter(Boolean).join(' ').trim())
          if (text.length < 80) continue
          const title = stripHtml(String(h.title ?? '')).slice(0, 180)
          if (!title) continue
          const sourceName = `hn:${String(h.objectID ?? 'unknown')}`
          signals.push({
            id: makeSignalId('hacker-news', sourceName, title),
            sourceType: 'hacker-news',
            sourceName,
            title,
            snippet: text.slice(0, 1200),
            url: `https://news.ycombinator.com/item?id=${String(h.objectID ?? '')}`,
            fetchedAt,
          })
        }
      } finally {
        clearTimeout(timer)
      }
    } catch { /* per-tag failure: ignore */ }
  }
  return signals
}

export async function fetchRedditSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const timeout = options.timeout ?? 10_000
  const signals: ProblemSignal[] = []
  const fetchedAt = new Date().toISOString()
  for (const sub of REDDIT_SUBREDDITS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=25`, {
          signal: ctrl.signal,
          headers: { 'User-Agent': REDDIT_AGENT },
        })
        if (!res.ok) continue
        const data = await res.json() as { data?: { children?: unknown[] } }
        for (const child of data.data?.children ?? []) {
          const post = (child as { data?: Record<string, unknown> }).data
          if (!post) continue
          const text = String(post.selftext ?? '').trim()
          if (text.length < 80) continue
          const title = String(post.title ?? '').slice(0, 180)
          const sourceName = `reddit:${sub}:${String(post.id ?? 'unknown')}`
          signals.push({
            id: makeSignalId('reddit', sourceName, title),
            sourceType: 'reddit',
            sourceName,
            title,
            snippet: text.slice(0, 1200),
            url: `https://www.reddit.com${String(post.permalink ?? '')}`,
            fetchedAt,
          })
        }
      } finally {
        clearTimeout(timer)
      }
    } catch { /* per-subreddit failure: ignore */ }
  }
  return signals
}

export async function fetchDcardSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const timeout = options.timeout ?? 10_000
  const signals: ProblemSignal[] = []
  const fetchedAt = new Date().toISOString()
  for (const forum of DCARD_FORUMS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const res = await fetch(`https://www.dcard.tw/_api/forums/${forum}/posts?popular=false&limit=30`, {
          signal: ctrl.signal,
          headers: { 'User-Agent': DCARD_AGENT },
        })
        if (!res.ok) continue
        const data = await res.json() as unknown
        const posts = Array.isArray(data) ? data : []
        for (const raw of posts) {
          const post = raw as Record<string, unknown>
          // Dcard's _api returns short excerpts (~70-120 chars), unlike
          // Reddit's full selftext. Combine title + excerpt so the AI
          // keep/skip stage has enough context and posts with short
          // excerpts are not dropped by the 80-char minimum.
          const excerpt = String(post.excerpt ?? '').trim()
          const titleRaw = String(post.title ?? '').trim()
          const text = `${titleRaw}. ${excerpt}`.trim()
          if (text.length < 80) continue
          const title = titleRaw.slice(0, 180)
          if (!title) continue
          const id = String(post.id ?? 'unknown')
          const sourceName = `dcard:${forum}:${id}`
          signals.push({
            id: makeSignalId('dcard', sourceName, title),
            sourceType: 'dcard',
            sourceName,
            title,
            snippet: text.slice(0, 1200),
            url: `https://www.dcard.tw/f/${forum}/p/${id}`,
            fetchedAt,
          })
        }
      } finally {
        clearTimeout(timer)
      }
    } catch { /* per-forum failure: ignore */ }
  }
  return signals
}

export async function fetchExternalSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const [hn, reddit, dcard] = await Promise.all([
    fetchHackerNewsSignals(options).catch((): ProblemSignal[] => []),
    fetchRedditSignals(options).catch((): ProblemSignal[] => []),
    fetchDcardSignals(options).catch((): ProblemSignal[] => []),
  ])
  return [...hn, ...reddit, ...dcard]
}
