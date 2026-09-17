/* ═══════════════════════════════════════════════════
   Nyx Agent — /api/chat
   Proxies chat completions to NIM → Groq → Gemini (fallback)
   + web search (tool calling / keyword detection)
   + Langfuse observability traces

   Env vars:
   - NVIDIA_NIM_API_KEY
   - GROQ_API_KEY
   - GEMINI_API_KEY / GOOGLE_GEMINI_API_KEY
   - LANGSEARCH_API_KEY
   - SERPER_API_KEY
   - OLLAMA_BASE_URL       (optional, self-hosted)
   - LANGFUSE_PUBLIC_KEY   (optional, observability)
   - LANGFUSE_SECRET_KEY   (optional, observability)
   - LANGFUSE_BASE_URL     (optional, defaults to cloud)
═══════════════════════════════════════════════════ */

import { NextRequest } from 'next/server'
import { buildSystemPrompt, buildOllamaSystemPrompt } from '@/lib/system-prompt'
import { executeSearch, formatSearchContext } from '@/app/api/search/route'
import {
  createChatTrace,
  createSearchSpan,
  createGeneration,
  endGenerationSuccess,
  endGenerationError,
  updateTraceOutput,
  flushLangfuse,
} from '@/lib/langfuse'

// ── Provider URLs ──────────────────────────────────

const NIM_URL    = 'https://integrate.api.nvidia.com/v1/chat/completions'
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '')
const OLLAMA_URL      = OLLAMA_BASE_URL ? `${OLLAMA_BASE_URL}/v1/chat/completions` : null

// ── Model fallback order (auto mode) ──────────────

const AUTO_FALLBACK_ORDER = [
  { model: 'openai/gpt-oss-20b',                 provider: 'nim'    },
  { model: 'moonshotai/kimi-k3',                 provider: 'nim'    },
  { model: 'nvidia/nemotron-3-ultra-550b-a55b',  provider: 'nim'    },
  { model: 'deepseek-ai/deepseek-v4-flash-0731', provider: 'nim'    },
  { model: 'deepseek-ai/deepseek-v4-pro-0813',   provider: 'nim'    },
  { model: 'groq/compound',                       provider: 'groq'   },
  { model: 'openai/gpt-oss-20b',                 provider: 'groq'   },
  { model: 'openai/gpt-oss-120b',                provider: 'groq'   },
  { model: 'qwen/qwen3.6-27b',                   provider: 'groq'   },
  { model: 'groq/compound-mini',                 provider: 'groq'   },
  { model: 'gemini-3.6-flash',                   provider: 'gemini' },
  { model: 'gemini-3.5-flash-lite',              provider: 'gemini' },
  { model: 'gemini-3.1-pro-preview',             provider: 'gemini' },
  { model: 'gemini-flash-latest',                provider: 'gemini' },
]

const GEMINI_MODEL_REMAPS: Record<string, string> = {
  'gemini-2.5-flash':      'gemini-3.6-flash',
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-pro':        'gemini-3.1-pro-preview',
  'gemini-1.5-flash':      'gemini-3.6-flash',
  'gemini-1.5-pro':        'gemini-3.1-pro-preview',
}

function remapGeminiModel(modelId: string): string {
  return GEMINI_MODEL_REMAPS[modelId] || modelId
}

function detectProvider(modelId: string): { provider: string; model: string } {
  if (!modelId) return { provider: 'nim', model: modelId }
  if (modelId.startsWith('custom/')) {
    const parts = modelId.split('/')
    return { provider: `custom:${parts[1]}`, model: decodeURIComponent(parts.slice(2).join('/')) }
  }
  if (modelId.startsWith('ollama/'))  return { provider: 'ollama', model: modelId.slice(7) }
  if (modelId.startsWith('groq/'))    return { provider: 'groq',   model: modelId.slice(5) }
  if (modelId.startsWith('gemini/'))  return { provider: 'gemini', model: remapGeminiModel(modelId.slice(7)) }
  return { provider: 'nim', model: modelId }
}

function getProviderUrl(provider: string): string | null {
  if (provider === 'groq')   return GROQ_URL
  if (provider === 'gemini') return GEMINI_URL
  if (provider === 'ollama') return OLLAMA_URL
  return NIM_URL
}

// ── Message types ──────────────────────────────────

type ApiMessage = { role: string; content: unknown; tool_calls?: unknown[] }
type CustomProvider = { id: string; name: string; baseUrl: string; apiKey: string; directConnection?: boolean }

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .map(p => (typeof p === 'string' ? p : p?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

// ── Request builder ────────────────────────────────

interface ProviderRequest {
  url: string
  body: unknown
  headers: Record<string, string>
  apiKeyMode: 'bearer' | 'query'
  apiKey?: string
}

function buildProviderRequest(opts: {
  provider: string
  modelId: string
  finalMessages: ApiMessage[]
  maxTokens: number
  temperature: number
  seed: number
  stream: boolean
  nimKey: string
  groqKey: string
  geminiKey: string
  customProvider?: CustomProvider
}): ProviderRequest {
  const { provider, modelId, finalMessages, maxTokens, temperature, seed, stream, nimKey, groqKey, geminiKey, customProvider } = opts

  if (provider === 'gemini') {
    const sysMsg       = finalMessages.find(m => m.role === 'system')
    const conversation = finalMessages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : extractText(m.content) }],
      }))
    if (conversation.length > 0 && conversation[0].role !== 'user') {
      conversation.unshift({ role: 'user', parts: [{ text: '(continue)' }] })
    }
    const body: Record<string, unknown> = {
      contents:         conversation,
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }
    if (sysMsg) {
      body.systemInstruction = {
        role:  'system',
        parts: [{ text: typeof sysMsg.content === 'string' ? sysMsg.content : extractText(sysMsg.content) }],
      }
    }
    const action = stream ? 'streamGenerateContent' : 'generateContent'
    const url    = `${GEMINI_URL}/${modelId}:${action}?alt=sse&key=${encodeURIComponent(geminiKey)}`
    return { url, body, headers: { 'Content-Type': 'application/json' }, apiKeyMode: 'query', apiKey: geminiKey }
  }

  // OpenAI-compatible providers, including custom providers.
  const isCustom = provider.startsWith('custom:')
  const apiKey = isCustom ? (customProvider?.apiKey || '') : provider === 'groq' ? groqKey : provider === 'ollama' ? '' : nimKey
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept':       stream ? 'text/event-stream' : 'application/json',
  }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const body = provider === 'groq' || provider === 'ollama' || isCustom
    ? { messages: finalMessages, model: modelId, max_tokens: maxTokens, temperature, stream }
    : { messages: finalMessages, model: modelId, max_tokens: maxTokens, temperature, seed, stream }

  return {
    url:        isCustom
      ? `${(customProvider?.baseUrl || '').replace(/\/$/, '')}${customProvider?.baseUrl?.endsWith('/chat/completions') ? '' : customProvider?.baseUrl?.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'}`
      : getProviderUrl(provider) || NIM_URL,
    body,
    headers,
    apiKeyMode: 'bearer',
    apiKey,
  }
}

// ── Web search ─────────────────────────────────────

const SEARCH_KEYWORDS = [
  'today','latest','current','now','recent','breaking','price','stock',
  'weather','news','score','result','happened','happening','update',
  'this week','this month','this year','right now','real-time','live',
  'harga','berita','terbaru','sekarang','saat ini','cuaca','hari ini',
  'kabar','terkini','bulan ini','minggu ini','tahun ini',
  'gaji','nilai','kurs','erupsi','gempa','banjir','bencana',
  'pertandingan','jadwal','skor','hasil','berapa','kapan','dimana',
  'update','rilis','launch','peluncuran',
]

const FILE_CONTEXT_PATTERNS = [
  /\b(baca|bacakan|analisis|analisa|rangkum|ringkas|jelaskan|summarize|analyze|read|explain|check|review)\b.{0,30}\b(file|dokumen|document|pdf|doc|gambar|image|foto|lampiran|attachment|ini|itu|tersebut|tadi)\b/i,
  /\b(file|dokumen|document|pdf|lampiran|attachment)\b.{0,30}\b(ini|itu|tersebut|tadi|yang|diatas|di atas)\b/i,
  /\bapa (isi|konten|content)\b/i,
]

function detectSearchNeed(userMessage: string): string | null {
  if (!userMessage) return null
  const lower = userMessage.toLowerCase()
  if (FILE_CONTEXT_PATTERNS.some(p => p.test(lower))) return null
  const needsSearch = SEARCH_KEYWORDS.some(kw => lower.includes(kw))
  if (!needsSearch) return null
  return userMessage.slice(0, 200)
}

function buildFallbackSearchMessages(finalMessages: ApiMessage[], searchQuery: string, searchResults: unknown[]): ApiMessage[] {
  const searchContext = formatSearchContext(searchQuery, searchResults as Parameters<typeof formatSearchContext>[1])
  const messages      = [...finalMessages]
  const sysIdx        = messages.findIndex(m => m.role === 'system')
  if (sysIdx >= 0) {
    const sysContent = typeof messages[sysIdx].content === 'string'
      ? messages[sysIdx].content as string
      : extractText(messages[sysIdx].content)
    messages[sysIdx] = { ...messages[sysIdx], content: sysContent + '\n\n' + searchContext }
  } else {
    messages.unshift({ role: 'system', content: searchContext })
  }
  return messages
}

// ── SSE helpers ────────────────────────────────────

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

// ── Token extraction from accumulated SSE ─────────

interface ParsedStreamResult {
  text: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

function parseAccumulatedSSE(accumulated: string, provider: string): ParsedStreamResult {
  let text         = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let totalTokens: number | undefined

  for (const line of accumulated.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const d = t.slice(5).trim()
    if (d === '[DONE]') continue
    try {
      const j = JSON.parse(d)
      // Content delta
      const token = provider === 'gemini'
        ? j?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
        : j?.choices?.[0]?.delta?.content
      if (token) text += token
      // Usage — some providers send a final chunk with usage
      const u = j?.usage
      if (u) {
        inputTokens  = u.prompt_tokens     ?? u.input_tokens     ?? inputTokens
        outputTokens = u.completion_tokens ?? u.output_tokens    ?? outputTokens
        totalTokens  = u.total_tokens                            ?? totalTokens
      }
    } catch { /* skip malformed chunks */ }
  }

  return { text, inputTokens, outputTokens, totalTokens }
}

// ── Main handler ───────────────────────────────────

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const nimKey    = process.env.NVIDIA_NIM_API_KEY    || ''
  const groqKey   = process.env.GROQ_API_KEY           || ''
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || ''

  const body = await req.json().catch(() => ({})) as {
    messages?:    ApiMessage[]
    model?:       string
    max_tokens?:  number
    temperature?: number
    seed?:        number
    stream?:      boolean
    sessionId?:   string
    userId?:      string
    webSearch?:   boolean
    skills?:      Array<{ name?: string; content?: string }>
    customProviders?: CustomProvider[]
  }

  const {
    messages,
    model       = 'auto',
    max_tokens  = 1024,
    temperature = 0.2,
    seed        = 0,
    stream      = true,
    sessionId,
    userId,
    webSearch = false,
    skills = [],
    customProviders = [],
  } = body

  if (!nimKey && !groqKey && !geminiKey && customProviders.length === 0) {
    return Response.json({ error: 'No API keys or custom providers configured.' }, { status: 500 })
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages array is required' }, { status: 400 })
  }

  // ── Determine models to try ──
  const isAuto = model === 'auto'
  let modelsToTry = isAuto
    ? [...AUTO_FALLBACK_ORDER]
    : [detectProvider(model)]

  modelsToTry = modelsToTry.filter(m => {
    if (m.provider === 'nim')    return !!nimKey
    if (m.provider === 'groq')   return !!groqKey
    if (m.provider === 'gemini') return !!geminiKey
    if (m.provider === 'ollama') return !!OLLAMA_URL
    if (m.provider.startsWith('custom:')) return customProviders.some(provider => provider.id === m.provider.slice(7) && !provider.directConnection)
    return false
  })

  if (modelsToTry.length === 0) {
    return Response.json({ error: 'No available providers.' }, { status: 503 })
  }

  // ── Extract user text for tracing ──
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
  const lastUserText = (() => {
    const c = lastUserMsg?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return (c as Array<{type?: string; text?: string}>)
        .filter(p => p.type === 'text' && !p.text?.startsWith('--- File:') && !p.text?.startsWith('[Attached file:'))
        .map(p => p.text || '')
        .join(' ')
        .trim()
    }
    return ''
  })()

  const lastUserHasFile = Array.isArray(lastUserMsg?.content) &&
    (lastUserMsg!.content as Array<{type?: string; text?: string}>).some(
      p => p.type === 'image_url' || (p.type === 'text' && p.text?.startsWith('--- File:'))
    )

  // ── Create root Langfuse trace (one per chat turn) ──
  const trace = createChatTrace({
    sessionId,
    userId,
    userInput: lastUserText,
  })

  // ── Web search pre-phase ──
  const hasSearch   = !!(process.env.LANGSEARCH_API_KEY || process.env.SERPER_API_KEY)
  let didSearch     = false
  let searchQuery: string | null = null
  let searchResult: { results: unknown[]; provider: string } | null = null

  const hasSystem = messages.some(m => m.role === 'system')
  const skillContext = skills
    .filter(skill => skill?.name && skill?.content)
    .slice(0, 10)
    .map(skill => `\n\n[Installed Skill: ${skill.name}]\n${skill.content}\n[End Skill: ${skill.name}]`)
    .join('')

  // ── Build the streaming response ──
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let streamClosed = false

  const readableStream = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  const write = (chunk: string) => {
    if (!streamClosed) {
      try { controller.enqueue(encoder.encode(chunk)) } catch { /* closed */ }
    }
  }
  const close = () => {
    if (!streamClosed) {
      streamClosed = true
      try { controller.close() } catch { /* already closed */ }
    }
  }

  // ── Async main logic ──
  ;(async () => {
    // Pre-search phase
    if (hasSearch && stream && lastUserText && (!lastUserHasFile || webSearch)) {
      const fallbackQuery = webSearch ? lastUserText.slice(0, 200) : detectSearchNeed(lastUserText)
      if (fallbackQuery) {
        searchQuery = fallbackQuery
        write(sseEvent({ type: 'searching', query: searchQuery }))

        // Trace the search as its own span nested under the chat trace
        const searchSpan = trace ? createSearchSpan(trace, searchQuery) : null

        try {
          searchResult = await executeSearch(searchQuery)
          searchSpan?.end({
            output:   { resultsCount: searchResult.results.length, provider: searchResult.provider },
            metadata: { provider: searchResult.provider },
          })
        } catch (e) {
          const msg = (e as Error).message
          console.warn('[chat] Search failed:', msg)
          searchResult = { results: [], provider: 'none' }
          searchSpan?.end({ output: msg, level: 'ERROR', statusMessage: msg })
        }

        didSearch = true
        write(sseEvent({ type: 'search_done', resultsCount: searchResult.results.length }))

        const sourcesPayload = (searchResult.results as Array<{title?: string; url?: string; link?: string}>).slice(0, 8).map((r, i) => ({
          index:  i + 1,
          title:  r.title || '',
          url:    r.url   || r.link || '',
          domain: (() => { try { return new URL(r.url || r.link || '').hostname.replace(/^www\./, '') } catch { return r.url || '' } })(),
        }))
        write(sseEvent({ type: 'sources', sources: sourcesPayload }))
      }
    }

    // Model loop
    for (let i = 0; i < modelsToTry.length; i++) {
      const { model: tryModel, provider } = modelsToTry[i]
      const isLast = i === modelsToTry.length - 1

      // Build messages with system prompt for this model
      let messagesForAttempt: ApiMessage[]
      if (!hasSystem) {
        const sysPrompt = provider === 'ollama'
          ? { role: 'system' as const, content: buildOllamaSystemPrompt(tryModel) }
          : { role: 'system' as const, content: buildSystemPrompt(tryModel, provider) }

        if (didSearch && searchResult) {
          const searchContext = formatSearchContext(searchQuery!, searchResult.results as Parameters<typeof formatSearchContext>[1])
          messagesForAttempt = [
            { ...sysPrompt, content: sysPrompt.content + skillContext + '\n\n' + searchContext },
            ...messages,
          ]
        } else {
          messagesForAttempt = [{ ...sysPrompt, content: sysPrompt.content + skillContext }, ...messages]
        }
      } else {
        messagesForAttempt = didSearch && searchResult
          ? buildFallbackSearchMessages(messages, searchQuery!, searchResult.results as Parameters<typeof formatSearchContext>[1])
          : messages
        if (skillContext) {
          const skillSystemIndex = messagesForAttempt.findIndex(message => message.role === 'system')
          if (skillSystemIndex >= 0) {
            messagesForAttempt = messagesForAttempt.map((message, index) => index === skillSystemIndex
              ? { ...message, content: extractText(message.content) + skillContext }
              : message
            )
          } else {
            messagesForAttempt = [{ role: 'system', content: skillContext }, ...messagesForAttempt]
          }
        }
      }

      if (provider === 'ollama' && !OLLAMA_URL) {
        if (!isLast) continue
        write(sseEvent({ type: 'error', message: 'Ollama not configured.' }))
        await flushLangfuse()
        close()
        return
      }

      const request = buildProviderRequest({
        provider, modelId: tryModel, finalMessages: messagesForAttempt,
        maxTokens: max_tokens, temperature, seed, stream,
        nimKey, groqKey, geminiKey,
        customProvider: provider.startsWith('custom:') ? customProviders.find(item => item.id === provider.slice(7)) : undefined,
      })

      // One generation per provider attempt — nested under the chat trace
      const generation = trace
        ? createGeneration(trace, {
            model:        tryModel,
            provider,
            messages:     messagesForAttempt,
            attemptIndex: i,
          })
        : null

      const connectTimeout = provider === 'ollama' ? 90_000 : 6_000
      const abortCtrl      = new AbortController()
      const timeoutId      = setTimeout(() => abortCtrl.abort(), connectTimeout)

      try {
        const apiResp = await fetch(request.url, {
          method:  'POST',
          headers: request.headers,
          body:    JSON.stringify(request.body),
          signal:  abortCtrl.signal,
        })
        clearTimeout(timeoutId)

        if (apiResp.status === 429 || apiResp.status >= 500) {
          const errText = await apiResp.text().catch(() => `HTTP ${apiResp.status}`)
          if (generation) endGenerationError(generation, `rate-limited or server error: ${apiResp.status}`)
          if (!isLast) continue
          write(sseEvent({ type: 'error', message: 'All models are rate-limited. Please try again.' }))
          await flushLangfuse()
          close()
          return
        }

        if (!apiResp.ok) {
          const errText = await apiResp.text().catch(() => `HTTP ${apiResp.status}`)
          if (generation) endGenerationError(generation, `api error ${apiResp.status}: ${errText.slice(0, 200)}`)
          if (!isLast) continue
          write(sseEvent({ type: 'error', message: "The AI couldn't generate a reply. Please try again." }))
          await flushLangfuse()
          close()
          return
        }

        // Send model identity headers via SSE event
        write(sseEvent({ type: 'model_used', model: tryModel, provider }))

        // Stream response body
        const reader     = apiResp.body!.getReader()
        const decoder    = new TextDecoder()
        let accumulated  = ''

        while (true) {
          const streamTimer = setTimeout(() => abortCtrl.abort(), 6_000)
          let chunk: ReadableStreamReadResult<Uint8Array>
          try {
            chunk = await reader.read()
          } catch (readErr) {
            clearTimeout(streamTimer)
            throw readErr
          }
          clearTimeout(streamTimer)
          if (chunk.done) break

          const decoded = decoder.decode(chunk.value, { stream: true })
          accumulated  += decoded
          write(decoded)
        }

        // Parse output text and token usage from accumulated SSE
        const { text: outputText, inputTokens, outputTokens, totalTokens } = parseAccumulatedSSE(accumulated, provider)

        if (generation) {
          endGenerationSuccess(generation, outputText, { inputTokens, outputTokens, totalTokens })
        }

        // Update trace-level output with the final assistant reply
        if (trace && outputText) {
          updateTraceOutput(trace, outputText)
        }

        await flushLangfuse()
        close()
        return

      } catch (error) {
        clearTimeout(timeoutId)
        const errMsg = (error as Error).message

        if (generation) endGenerationError(generation, errMsg)

        if ((error as Error).name === 'AbortError') {
          if (!isLast) continue
          write(sseEvent({ type: 'error', message: 'All models timed out. Please try again.' }))
          await flushLangfuse()
          close()
          return
        }

        if (!isLast) continue
        write(sseEvent({ type: 'error', message: "The AI couldn't generate a reply. Please try again." }))
        await flushLangfuse()
        close()
        return
      }
    }

    await flushLangfuse()
    close()
  })()

  return new Response(readableStream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
