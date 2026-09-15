/* ═══════════════════════════════════════════════════
   Nyx Agent — /api/search
   Web search with LangSearch (primary) + Serper (fallback)
═══════════════════════════════════════════════════ */

import { NextRequest, NextResponse } from 'next/server'

const LANGSEARCH_URL = 'https://api.langsearch.com/v1/web-search'
const SERPER_URL     = 'https://google.serper.dev/search'

const MAX_RESULTS      = 5
const SEARCH_TIMEOUT_MS = 5000

export interface SearchResult {
  title:   string
  url:     string
  snippet: string
  date?:   string
}

export interface SearchResponse {
  results:  SearchResult[]
  provider: 'langsearch' | 'serper' | 'none'
}

function normalizeLangSearch(data: unknown): SearchResult[] {
  const d = data as { results?: Array<{ title?: string; url?: string; link?: string; snippet?: string; summary?: string; published_date?: string; date?: string }> }
  if (!d?.results || !Array.isArray(d.results)) return []
  return d.results.slice(0, MAX_RESULTS).map(r => ({
    title:   r.title   || '',
    url:     r.url     || r.link  || '',
    snippet: r.snippet || r.summary || '',
    date:    r.published_date || r.date || undefined,
  }))
}

function normalizeSerper(data: unknown): SearchResult[] {
  const d = data as { organic?: Array<{ title?: string; link?: string; url?: string; snippet?: string; date?: string }> }
  if (!d?.organic || !Array.isArray(d.organic)) return []
  return d.organic.slice(0, MAX_RESULTS).map(r => ({
    title:   r.title   || '',
    url:     r.link    || r.url  || '',
    snippet: r.snippet || '',
    date:    r.date    || undefined,
  }))
}

async function searchLangSearch(query: string, apiKey: string): Promise<SearchResponse> {
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const resp = await fetch(LANGSEARCH_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:   JSON.stringify({ query, freshness: 'noLimit', count: MAX_RESULTS }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) { await resp.text().catch(() => {}); throw new Error(`LangSearch ${resp.status}`) }
    const data = await resp.json()
    return { results: normalizeLangSearch(data), provider: 'langsearch' }
  } catch (e) { clearTimeout(timeoutId); throw e }
}

async function searchSerper(query: string, apiKey: string): Promise<SearchResponse> {
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const resp = await fetch(SERPER_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body:   JSON.stringify({ q: query, num: MAX_RESULTS }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) { await resp.text().catch(() => {}); throw new Error(`Serper ${resp.status}`) }
    const data = await resp.json()
    return { results: normalizeSerper(data), provider: 'serper' }
  } catch (e) { clearTimeout(timeoutId); throw e }
}

export async function executeSearch(query: string): Promise<SearchResponse> {
  const trimmed = (query || '').slice(0, 200).trim()
  if (!trimmed) return { results: [], provider: 'none' }

  const langSearchKey = process.env.LANGSEARCH_API_KEY
  const serperKey     = process.env.SERPER_API_KEY

  if (langSearchKey) {
    try {
      const result = await searchLangSearch(trimmed, langSearchKey)
      if (result.results.length > 0) return result
    } catch (e) {
      console.warn('[search] LangSearch failed:', (e as Error).message)
    }
  }

  if (serperKey) {
    try {
      const result = await searchSerper(trimmed, serperKey)
      if (result.results.length > 0) return result
    } catch (e) {
      console.warn('[search] Serper failed:', (e as Error).message)
    }
  }

  return { results: [], provider: 'none' }
}

export function formatSearchContext(query: string, results: SearchResult[]): string {
  if (!results || results.length === 0) {
    return `[Tool Result — web_search]\nQuery: "${query}"\n\nNo results found.\n\n[End of search results]`
  }
  const lines = results.map((r, i) => {
    const dateStr = r.date ? ` — ${r.date}` : ''
    return `${i + 1}. ${r.title}\n   URL: ${r.url}${dateStr}\n   ${r.snippet}`
  })
  return `[Web Search Results — MUST cite source numbers [1], [2], etc. for every claim]\nQuery: "${query}"\n\n${lines.join('\n\n')}\n\n[End of search results — cite sources using [1], [2], etc.]\n\nIMPORTANT: The dates shown next to search results are the publication dates of those articles/pages, NOT today's date. Always use the current date from the system prompt above when referring to "today".`
}

// ── HTTP handler ──────────────────────────────────

export async function POST(req: NextRequest) {
  const body  = await req.json().catch(() => ({}))
  const query = body?.query

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Query string is required' }, { status: 400 })
  }

  const result = await executeSearch(query)
  return NextResponse.json(result)
}
