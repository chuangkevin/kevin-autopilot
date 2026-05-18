import { createProblemSignal } from './problem-discovery.js'
import type { ProblemSignal } from './types.js'

const HN_QUERIES = [
  'workflow broken manual hours',
  'tool missing automate annoying',
  'frustrating repetitive process workaround',
]
const HN_TAGS = ['ask_hn', 'show_hn']
const HN_BASE = 'https://hn.algolia.com/api/v1/search'

export async function fetchHackerNewsSignals(options: { timeout?: number } = {}): Promise<ProblemSignal[]> {
  const timeout = options.timeout ?? 10_000
  const signals: ProblemSignal[] = []
  const fetchedAt = new Date().toISOString()
  for (const tag of HN_TAGS) {
    for (const query of HN_QUERIES) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeout)
        try {
          const res = await fetch(`${HN_BASE}?query=${encodeURIComponent(query)}&tags=${tag}&hitsPerPage=10`, { signal: ctrl.signal })
          if (!res.ok) continue
          const data = await res.json() as { hits?: unknown[] }
          for (const hit of data.hits ?? []) {
            const h = hit as Record<string, unknown>
            const text = [String(h.story_text ?? ''), String(h.comment_text ?? '')].filter(Boolean).join(' ').trim()
            if (text.length < 80) continue
            signals.push(createProblemSignal({
              sourceType: 'hacker-news',
              sourceName: `hacker-news:${String(h.objectID ?? 'unknown')}`,
              title: String(h.title ?? query).slice(0, 180),
              snippet: text.slice(0, 1200),
              fetchedAt,
              url: `https://news.ycombinator.com/item?id=${String(h.objectID ?? '')}`,
              query,
            }))
          }
        } finally {
          clearTimeout(timer)
        }
      } catch { /* per-query failure: ignore and continue */ }
    }
  }
  return signals
}

const REDDIT_SUBREDDITS = ['smallbusiness', 'freelance', 'productivity', 'SideProject']
const REDDIT_AGENT = 'kevin-autopilot/1.0 (personal research tool)'

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
          signals.push(createProblemSignal({
            sourceType: 'reddit',
            sourceName: `reddit:${sub}:${String(post.id ?? 'unknown')}`,
            title: String(post.title ?? '').slice(0, 180),
            snippet: text.slice(0, 1200),
            fetchedAt,
            url: `https://www.reddit.com${String(post.permalink ?? '')}`,
            query: sub,
          }))
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
