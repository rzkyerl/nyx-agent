/* ═══════════════════════════════════════════════════
   Nyx Agent — /api/title
  Auto-generate short conversation title from the conversation summary
   + Langfuse tracing for title-generation calls
═══════════════════════════════════════════════════ */

import { NextRequest, NextResponse } from 'next/server'
import {
  getLangfuse,
  flushLangfuse,
} from '@/lib/langfuse'

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

interface CustomProvider {
  id: string
  baseUrl: string
  apiKey: string
  directConnection?: boolean
  models?: Array<{ id: string }>
}

interface TitleCandidate {
  provider: 'nim' | 'groq' | 'gemini' | 'ollama' | 'custom'
  model: string
  apiKey?: string
  baseUrl?: string
  label: string
}

const AUTO_CANDIDATES = [
  { provider: 'nim' as const, model: 'openai/gpt-oss-20b', label: 'NIM' },
  { provider: 'groq' as const, model: 'compound-mini', label: 'Groq' },
  { provider: 'gemini' as const, model: 'gemini-3.6-flash', label: 'Gemini' },
  { provider: 'ollama' as const, model: 'llama3.1:8b', label: 'Ollama' },
]

function detectModel(modelId: string): { provider: TitleCandidate['provider']; model: string; customId?: string } {
  if (modelId.startsWith('custom/')) {
    const parts = modelId.split('/')
    return { provider: 'custom', customId: parts[1], model: decodeURIComponent(parts.slice(2).join('/')) }
  }
  if (modelId.startsWith('groq/')) return { provider: 'groq', model: modelId.slice(5) }
  if (modelId.startsWith('gemini/')) return { provider: 'gemini', model: modelId.slice(7) }
  if (modelId.startsWith('ollama/')) return { provider: 'ollama', model: modelId.slice(7) }
  return { provider: 'nim', model: modelId }
}

function fallbackTitle(message: string): string {
  return normalizeTitle(message.slice(0, 40).trim()) + (message.length > 40 ? '...' : '')
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim().replace(/[.!?]+$/, '')
  if (!trimmed) return trimmed
  if (trimmed === trimmed.toLowerCase()) {
    return trimmed.charAt(0).toLocaleUpperCase('id-ID') + trimmed.slice(1)
  }
  return trimmed
}

const titleMessages = (message: string) => [
  {
    role:    'system',
    content: "Generate a very short title (2-6 words, no quotes, no punctuation at the end) that summarizes the conversation topic. Use both the user's request and the assistant's response. Respond with only the title text, nothing else.",
  },
  { role: 'user', content: message.slice(0, 500) },
]

export async function POST(req: NextRequest) {
  const body    = await req.json().catch(() => ({}))
  const message = body?.message
  const sessionId = body?.sessionId as string | undefined
  const requestedModel = typeof body?.model === 'string' ? body.model : 'auto'
  const customProviders = Array.isArray(body?.customProviders) ? body.customProviders as CustomProvider[] : []

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  const nimKey = process.env.NVIDIA_NIM_API_KEY || ''
  const groqKey = process.env.GROQ_API_KEY || ''
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || ''
  const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '')
  const selected = requestedModel !== 'auto' ? detectModel(requestedModel) : null
  const modelsToTry: TitleCandidate[] = []

  const addCandidate = (candidate: TitleCandidate) => {
    const key = `${candidate.provider}:${candidate.model}:${candidate.baseUrl || ''}`
    if (!modelsToTry.some(item => `${item.provider}:${item.model}:${item.baseUrl || ''}` === key)) modelsToTry.push(candidate)
  }

  if (selected) {
    const custom = selected.customId ? customProviders.find(item => item.id === selected.customId) : undefined
    if (!custom?.directConnection) {
      addCandidate({
        ...selected,
        label: selected.provider,
        apiKey: selected.provider === 'nim' ? nimKey : selected.provider === 'groq' ? groqKey : selected.provider === 'gemini' ? geminiKey : custom?.apiKey,
        baseUrl: selected.provider === 'ollama' ? ollamaBaseUrl : custom?.baseUrl,
      })
    }
  }

  for (const candidate of AUTO_CANDIDATES) {
    const apiKey = candidate.provider === 'nim' ? nimKey : candidate.provider === 'groq' ? groqKey : candidate.provider === 'gemini' ? geminiKey : ollamaBaseUrl
    if (apiKey) addCandidate({ ...candidate, apiKey, baseUrl: candidate.provider === 'ollama' ? ollamaBaseUrl : undefined })
  }
  for (const provider of customProviders) {
    if (provider.apiKey && provider.baseUrl && !provider.directConnection) {
      for (const model of provider.models || []) {
        addCandidate({ provider: 'custom', model: model.id, apiKey: provider.apiKey, baseUrl: provider.baseUrl, label: provider.id })
      }
    }
  }

  if (modelsToTry.length === 0) return NextResponse.json({ title: fallbackTitle(message) })

  const lf       = getLangfuse()
  const messages = titleMessages(message)

  // Create a short-lived trace for title generation.
  // Linked to the same sessionId as the chat turn so the session
  // view shows the title alongside the conversation.
  const trace = lf?.trace({
    name:        'title-generation',
    sessionId,
    input:       message.slice(0, 500),
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    tags:        ['title'],
  }) ?? null

  for (let i = 0; i < modelsToTry.length; i++) {
    const candidate = modelsToTry[i]
    const { model: tryModel, provider } = candidate

    const generation = trace?.generation({
      name:       'title-completion',
      model:      tryModel,
      modelParameters: { provider, attemptIndex: String(i) },
      input:      messages,
      startTime:  new Date(),
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    }) ?? null

    try {
      const isGemini = provider === 'gemini'
      const isOllama = provider === 'ollama'
      const isCustom = provider === 'custom'
      const apiUrl = isGemini
        ? `${GEMINI_URL}/${tryModel}:generateContent?key=${encodeURIComponent(candidate.apiKey || '')}`
        : isOllama
          ? `${candidate.baseUrl}/v1/chat/completions`
          : isCustom
            ? `${(candidate.baseUrl || '').replace(/\/$/, '')}${candidate.baseUrl?.endsWith('/chat/completions') ? '' : candidate.baseUrl?.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'}`
            : provider === 'groq' ? GROQ_URL : NIM_URL
      const requestBody = isGemini
        ? { contents: [{ role: 'user', parts: [{ text: message.slice(0, 500) }] }], generationConfig: { maxOutputTokens: 30, temperature: 0.3 } }
        : { messages, model: tryModel, max_tokens: 30, temperature: 0.3, stream: false }
      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          ...(!isGemini && candidate.apiKey ? { 'Authorization': `Bearer ${candidate.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(8000),
      })

      if (!apiResponse.ok) {
        await apiResponse.text().catch(() => {})
        generation?.end({ output: `HTTP ${apiResponse.status}`, level: 'ERROR', statusMessage: `HTTP ${apiResponse.status}` })
        continue
      }

      const data  = await apiResponse.json()
      const title = (isGemini
        ? data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
        : data?.choices?.[0]?.message?.content) as string | undefined
      const cleanTitle = title ? normalizeTitle(title) : ''
      if (!cleanTitle) continue

      const usage = data?.usage
      generation?.end({
        output: cleanTitle,
        ...(usage && {
          usageDetails: {
            input:  usage.prompt_tokens     ?? 0,
            output: usage.completion_tokens ?? 0,
            total:  usage.total_tokens      ?? 0,
          },
        }),
      })

      // Set trace output to the generated title
      trace?.update({ output: cleanTitle.slice(0, 60) })

      await flushLangfuse()
      return NextResponse.json({ title: cleanTitle.slice(0, 60) })

    } catch (error) {
      const errMsg = (error as Error).message
      console.error(`[title] ${provider}/${tryModel}:`, errMsg)
      generation?.end({ output: errMsg, level: 'ERROR', statusMessage: errMsg })
      continue
    }
  }

  await flushLangfuse()
  return NextResponse.json({ title: fallbackTitle(message) })
}
