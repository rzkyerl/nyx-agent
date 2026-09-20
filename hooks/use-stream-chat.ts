'use client'

/* ═══════════════════════════════════════════════════
   useStreamChat — SSE streaming client
   Ported from nimClient.js (Vite project)
═══════════════════════════════════════════════════ */

import type { SourceItem } from '@/lib/storage'
import type { InstalledSkill } from '@/lib/skills'
import type { CustomProvider } from '@/lib/storage'
import { buildSystemPrompt } from '@/lib/system-prompt'

// ── Client-side web search helpers (used for direct connection mode) ──────────

const SEARCH_DETECT_PATTERNS = [
  /\b(hari ini|sekarang|terbaru|terkini|saat ini|berita|harga|cuaca|jadwal)\b/i,
  /\b(today|now|latest|current|recent|news|price|weather|score|election|winner)\b/i,
  /\b(berapa harga|berapa kurs|siapa yang menang|kapan rilis|apa yang terjadi)\b/i,
  /\b(what is the latest|who won|when did|what happened|stock price|exchange rate)\b/i,
]

function clientDetectSearchNeed(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length < 8) return null
  if (SEARCH_DETECT_PATTERNS.some(re => re.test(trimmed))) return trimmed.slice(0, 200)
  return null
}

interface ClientSearchResult {
  title: string
  url: string
  snippet: string
  date?: string
}

async function clientFetchSearch(query: string, signal?: AbortSignal): Promise<ClientSearchResult[]> {
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    })
    if (!res.ok) return []
    const data = await res.json() as { results?: ClientSearchResult[] }
    return data.results || []
  } catch {
    return []
  }
}

function clientFormatSearchContext(query: string, results: ClientSearchResult[]): string {
  if (!results.length) {
    return `[Tool Result — web_search]\nQuery: "${query}"\n\nNo results found.\n\n[End of search results]`
  }
  const lines = results.map((r, i) => {
    const dateStr = r.date ? ` — ${r.date}` : ''
    return `${i + 1}. ${r.title}\n   URL: ${r.url}${dateStr}\n   ${r.snippet}`
  })
  return `[Web Search Results — MUST cite source numbers [1], [2], etc. for every claim]\nQuery: "${query}"\n\n${lines.join('\n\n')}\n\n[End of search results — cite sources using [1], [2], etc.]\n\nIMPORTANT: The dates shown next to search results are the publication dates of those articles/pages, NOT today's date. Always use the current date from the system prompt above when referring to "today".`
}

interface StreamChatParams {
  messages:            Array<{ role: string; content: unknown }>
  model?:              string
  maxTokens?:          number
  temperature?:        number
  seed?:               number
  sessionId?:          string
  signal?:             AbortSignal
  webSearch?:          boolean
  skills?:             InstalledSkill[]
  customProviders?:    CustomProvider[]
  memory?:             string
  onToken:             (chunk: string) => void
  onModelUsed?:        (model: string, provider: string) => void
  onSearchStart?:      (query: string) => void
  onSearchDone?:       (count: number) => void
  onSources?:          (sources: SourceItem[]) => void
  onModelUnavailable?: (msg: string) => void
}

export async function streamChatCompletion(params: StreamChatParams): Promise<string> {
  const {
    messages, model = 'auto', maxTokens = 1024, temperature = 0.2,
    seed = 0, sessionId, signal, webSearch = false, skills = [], customProviders = [], memory = '',
    onToken, onModelUsed, onSearchStart, onSearchDone, onSources, onModelUnavailable,
  } = params

  const customModelMatch = model.match(/^custom\/([^/]+)\/(.+)$/)
  const customProvider = customModelMatch
    ? customProviders.find(provider => provider.id === customModelMatch[1])
    : undefined
  const directConnection = Boolean(customProvider?.directConnection)
  const customModelId = customModelMatch ? decodeURIComponent(customModelMatch[2]) : model
  const customBaseUrl = customProvider?.baseUrl.replace(/\/$/, '') || ''
  const customEndpoint = customBaseUrl.endsWith('/chat/completions')
    ? customBaseUrl
    : `${customBaseUrl}${customBaseUrl.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'}`

  // ── Client-side web search for direct connection mode ──────────────────────
  let directSearchResults: ClientSearchResult[] = []
  let directSearchQuery: string | null = null

  if (directConnection) {
    const lastUserText = (() => {
      const last = [...messages].reverse().find(m => m.role === 'user')
      if (!last) return ''
      const c = last.content
      if (typeof c === 'string') return c
      if (Array.isArray(c)) {
        return (c as Array<{ type?: string; text?: string }>)
          .filter(p => p.type === 'text' && !p.text?.startsWith('--- File:'))
          .map(p => p.text || '')
          .join(' ')
          .trim()
      }
      return ''
    })()

    const searchQuery = webSearch
      ? lastUserText.slice(0, 200)
      : clientDetectSearchNeed(lastUserText)

    if (searchQuery) {
      directSearchQuery = searchQuery
      onSearchStart?.(searchQuery)
      directSearchResults = await clientFetchSearch(searchQuery, signal)
      onSearchDone?.(directSearchResults.length)

      if (directSearchResults.length > 0) {
        const enrichedSources: SourceItem[] = directSearchResults.slice(0, 8).map((r, i) => {
          let domain = ''
          try { domain = new URL(r.url).hostname.replace(/^www\./, '') } catch { domain = '' }
          return {
            index: i + 1,
            title: r.title,
            url: r.url,
            domain,
            favicon: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '',
          }
        })
        onSources?.(enrichedSources)
      }
    }
  }

  // ── Build final messages for direct connection ─────────────────────────────
  let requestMessages: Array<{ role: string; content: unknown }>
  if (directConnection) {
    const systemContent = buildSystemPrompt(customModelId, customProvider?.name || 'Custom Provider', memory)
    const systemWithSearch = directSearchQuery && directSearchResults.length > 0
      ? systemContent + '\n\n' + clientFormatSearchContext(directSearchQuery, directSearchResults)
      : systemContent
    requestMessages = [{ role: 'system', content: systemWithSearch }, ...messages]
  } else {
    requestMessages = messages
  }

  const response = await fetch(directConnection ? customEndpoint : '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      ...(directConnection && customProvider?.apiKey ? { Authorization: `Bearer ${customProvider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      messages: requestMessages,
      model: directConnection ? customModelId : model,
      max_tokens:  maxTokens,
      temperature,
      seed,
      stream:      true,
      ...(directConnection ? {} : { sessionId, webSearch, skills, customProviders }),
      ...(memory.trim() ? { memory } : {}),
      customProviders,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let friendlyMsg = "Couldn't get a response. Please try again."
    try {
      const parsed = JSON.parse(text)
      if (parsed?.error && !parsed.error.includes('://') && parsed.error.length < 120) {
        friendlyMsg = parsed.error
      }
    } catch { /* ignore */ }
    throw new Error(friendlyMsg)
  }

  const reader    = response.body!.getReader()
  const decoder   = new TextDecoder()
  let buffer      = ''
  let fullText    = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer      = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue

      try {
        const json = JSON.parse(data)

        if (json.type === 'searching' && json.query) { onSearchStart?.(json.query); continue }
        if (json.type === 'search_done')              { onSearchDone?.(json.resultsCount || 0); continue }
        if (json.type === 'sources' && Array.isArray(json.sources)) {
          const enriched: SourceItem[] = json.sources.map((s: { index: number; title: string; url: string; domain?: string }) => {
            const url = s.url || ''
            let domain = s.domain || ''
            if (!domain && url) {
              try { domain = new URL(url).hostname.replace(/^www\./, '') } catch { domain = '' }
            }
            return {
              ...s,
              domain,
              favicon: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '',
            }
          })
          onSources?.(enriched)
          continue
        }
        if (json.type === 'model_used') {
          onModelUsed?.(json.model, json.provider)
          continue
        }
        if (json.type === 'error' || json.error) {
          const errMsg = json.message || json.error || 'Something went wrong'
          if (json.model_unavailable) { onModelUnavailable?.(errMsg); return fullText }
          throw new Error(errMsg)
        }

        const token = json?.choices?.[0]?.delta?.content
          || json?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
        if (token) { fullText += token; onToken(token) }
      } catch (parseErr) {
        // Only re-throw real errors, not JSON parse failures
        if ((parseErr as Error).message && !(parseErr instanceof SyntaxError)) throw parseErr
      }
    }
  }

  return fullText
}

/** Build message payload for the API (handles file attachments) */
export function buildApiMessages(
  messages: Array<{
    role: string
    content: string
    files?: Array<{ type: string; dataUrl?: string; name: string; size: number; extractedText?: string }>
  }>
): Array<{ role: string; content: unknown }> {
  return messages.map(msg => {
    if (!msg.files || msg.files.length === 0) {
      return { role: msg.role, content: msg.content }
    }

    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
    if (msg.content) content.push({ type: 'text', text: msg.content })

    for (const file of msg.files) {
      if (file.type === 'image' && file.dataUrl) {
        content.push({ type: 'image_url', image_url: { url: file.dataUrl } })
      } else if (file.type !== 'image') {
        if (file.extractedText && !file.extractedText.startsWith('[Could not')) {
          content.push({
            type: 'text',
            text: `--- File: ${file.name} ---\n\n${file.extractedText}\n\n--- End of ${file.name} ---`,
          })
        } else {
          content.push({
            type: 'text',
            text: `[Attached file: ${file.name} (${file.size} bytes) — content could not be extracted]`,
          })
        }
      }
    }

    return { role: msg.role, content }
  })
}

/** Detect hallucination indicator phrases in AI output */
const HALLUCINATION_PHRASES = [
  /berdasarkan pengetahuan saya hingga/i,
  /berdasarkan data pelatihan saya/i,
  /saya tidak memiliki akses ke internet/i,
  /sebagai model bahasa/i,
  /i don't have access to real-time/i,
  /as of my knowledge cutoff/i,
  /i cannot browse the internet/i,
]

export function detectHallucinationWarning(text: string): boolean {
  return HALLUCINATION_PHRASES.some(re => re.test(text))
}
