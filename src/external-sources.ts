import { makeSignalId } from './problem-cards.js'
import type { ProblemSignal } from './types.js'

const HN_BASE = 'https://hn.algolia.com/api/v1/search'
const HN_TAGS: Array<'show_hn' | 'ask_hn'> = ['show_hn', 'ask_hn']
const REDDIT_SUBREDDITS = ['programming', 'ExperiencedDevs', 'SaaS', 'startups']
const REDDIT_AGENT = 'world-problem-radar/1.0 (personal research tool)'

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

export async function fetchExternalSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const [hn, reddit] = await Promise.all([
    fetchHackerNewsSignals(options).catch((): ProblemSignal[] => []),
    fetchRedditSignals(options).catch((): ProblemSignal[] => []),
  ])
  return [...hn, ...reddit]
}
