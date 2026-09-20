/* ═══════════════════════════════════════════════════
   Nyx Agent — /api/memory
   Extracts and merges user facts from the last conversation
   turn into the existing memory block.

   POST body:
   {
     userMessage:   string        // last user message
     assistantReply: string       // last assistant message
     currentMemory: string        // existing memory (may be empty)
     model?:        string        // model ID (uses auto-fallback)
     customProviders?: CustomProvider[]
   }

   Returns: { memory: string }
═══════════════════════════════════════════════════ */

import { NextRequest, NextResponse } from 'next/server'

const NIM_URL  = 'https://integrate.api.nvidia.com/v1/chat/completions'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '')

interface CustomProvider {
  id: string
  baseUrl: string
  apiKey: string
  directConnection?: boolean
  models?: Array<{ id: string }>
}

interface MemoryCandidate {
  provider: 'nim' | 'groq' | 'gemini' | 'ollama' | 'custom'
  model: string
  apiKey?: string
  baseUrl?: string
}

// Fast, cheap models preferred — memory extraction is a lightweight task
const AUTO_CANDIDATES: MemoryCandidate[] = [
  { provider: 'groq',   model: 'compound-mini' },
  { provider: 'nim',    model: 'openai/gpt-oss-20b' },
  { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  { provider: 'ollama', model: 'llama3.1:8b' },
]

function detectProvider(modelId: string): { provider: MemoryCandidate['provider']; model: string; customId?: string } {
  if (modelId.startsWith('custom/')) {
    const parts = modelId.split('/')
    return { provider: 'custom', customId: parts[1], model: decodeURIComponent(parts.slice(2).join('/')) }
  }
  if (modelId.startsWith('groq/'))   return { provider: 'groq',   model: modelId.slice(5) }
  if (modelId.startsWith('gemini/')) return { provider: 'gemini', model: modelId.slice(7) }
  if (modelId.startsWith('ollama/')) return { provider: 'ollama', model: modelId.slice(7) }
  return { provider: 'nim', model: modelId }
}

function buildApiUrl(candidate: MemoryCandidate): string {
  if (candidate.provider === 'gemini') {
    return `${GEMINI_URL}/${candidate.model}:generateContent?key=${encodeURIComponent(candidate.apiKey || '')}`
  }
  if (candidate.provider === 'ollama') {
    return `${candidate.baseUrl || OLLAMA_BASE_URL}/v1/chat/completions`
  }
  if (candidate.provider === 'custom') {
    const base = (candidate.baseUrl || '').replace(/\/$/, '')
    if (base.endsWith('/chat/completions')) return base
    return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  }
  return candidate.provider === 'groq' ? GROQ_URL : NIM_URL
}

function buildRequestBody(candidate: MemoryCandidate, systemPrompt: string, userPrompt: string) {
  if (candidate.provider === 'gemini') {
    return {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: 400, temperature: 0.1 },
    }
  }
  return {
    model: candidate.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens:  400,
    temperature: 0.1,
    stream:      false,
  }
}

function extractText(data: unknown, provider: string): string {
  if (provider === 'gemini') {
    const d = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    return d?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
  }
  const d = data as { choices?: Array<{ message?: { content?: string } }> }
  return d?.choices?.[0]?.message?.content || ''
}

const SYSTEM_PROMPT = `You are a memory manager for an AI assistant called Nyx Agent.

Your job: given the EXISTING MEMORY and the LATEST CONVERSATION TURN, produce an updated memory string.

Rules:
- Extract ONLY persistent, reusable facts about the user: preferences, profession, tools they use, language preference, recurring topics, explicit requests to remember something.
- DO NOT store one-time questions, temporary tasks, or general knowledge.
- Merge new facts with existing memory — update or remove facts that are contradicted by new information.
- Keep the output concise: a short bulleted list or a few plain sentences. Max ~300 words.
- Write in the same language the user is using (Indonesian or English).
- If there is nothing worth remembering from this turn AND the existing memory is already accurate, return the existing memory unchanged.
- If there is truly nothing to remember at all, return an empty string.
- Output ONLY the memory text — no explanation, no preamble, no labels.`

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    userMessage?:    string
    assistantReply?: string
    currentMemory?:  string
    model?:          string
    customProviders?: CustomProvider[]
  }

  const {
    userMessage    = '',
    assistantReply = '',
    currentMemory  = '',
    model          = 'auto',
    customProviders = [],
  } = body

  if (!userMessage.trim() && !assistantReply.trim()) {
    return NextResponse.json({ memory: currentMemory })
  }

  const nimKey    = process.env.NVIDIA_NIM_API_KEY    || ''
  const groqKey   = process.env.GROQ_API_KEY           || ''
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || ''

  // Build candidate list
  const candidates: MemoryCandidate[] = []
  const seen = new Set<string>()

  const add = (c: MemoryCandidate) => {
    const key = `${c.provider}:${c.model}`
    if (!seen.has(key)) { seen.add(key); candidates.push(c) }
  }

  // If a specific model was requested, try it first
  if (model !== 'auto') {
    const detected = detectProvider(model)
    const custom = detected.customId ? customProviders.find(p => p.id === detected.customId) : undefined
    if (!custom?.directConnection) {
      add({
        provider: detected.provider,
        model:    detected.model,
        apiKey:   detected.provider === 'nim' ? nimKey
                : detected.provider === 'groq' ? groqKey
                : detected.provider === 'gemini' ? geminiKey
                : custom?.apiKey,
        baseUrl:  detected.provider === 'ollama' ? OLLAMA_BASE_URL : custom?.baseUrl,
      })
    }
  }

  // Then add auto-fallback candidates
  for (const c of AUTO_CANDIDATES) {
    const key = c.provider === 'nim' ? nimKey : c.provider === 'groq' ? groqKey : c.provider === 'gemini' ? geminiKey : OLLAMA_BASE_URL
    if (key) add({ ...c, apiKey: key, baseUrl: c.provider === 'ollama' ? OLLAMA_BASE_URL : undefined })
  }

  // Also try custom providers (non-direct)
  for (const p of customProviders) {
    if (p.apiKey && p.baseUrl && !p.directConnection) {
      for (const m of p.models || []) {
        add({ provider: 'custom', model: m.id, apiKey: p.apiKey, baseUrl: p.baseUrl })
      }
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({ memory: currentMemory })
  }

  const userPrompt = `EXISTING MEMORY:
${currentMemory.trim() || '(empty)'}

LATEST CONVERSATION TURN:
User: ${userMessage.slice(0, 600)}
Assistant: ${assistantReply.slice(0, 600)}

Write the updated memory:`

  for (const candidate of candidates) {
    try {
      const url  = buildApiUrl(candidate)
      const reqBody = buildRequestBody(candidate, SYSTEM_PROMPT, userPrompt)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (candidate.provider !== 'gemini' && candidate.apiKey) {
        headers['Authorization'] = `Bearer ${candidate.apiKey}`
      }

      const response = await fetch(url, {
        method:  'POST',
        headers,
        body:    JSON.stringify(reqBody),
        signal:  AbortSignal.timeout(10_000),
      })

      if (!response.ok) { await response.text().catch(() => {}); continue }

      const data    = await response.json()
      const updated = extractText(data, candidate.provider).trim()

      // Return current memory unchanged if the model returned nothing useful
      return NextResponse.json({ memory: updated || currentMemory })
    } catch (err) {
      console.warn(`[memory] ${candidate.provider}/${candidate.model} failed:`, (err as Error).message)
      continue
    }
  }

  // All providers failed — keep existing memory
  return NextResponse.json({ memory: currentMemory })
}
