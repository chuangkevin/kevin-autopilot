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
        const res = await fetch(`${HN_BASE}?query=${encodeURIComponent(query)}&tags=${tag}&hitsPerPage=10`, { signal: ctrl.signal })
        clearTimeout(timer)
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
      } catch { /* per-query failure: ignore and continue */ }
    }
  }
  return signals
}
