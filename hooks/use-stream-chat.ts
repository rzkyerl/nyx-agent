'use client'

/* ═══════════════════════════════════════════════════
   useStreamChat — SSE streaming client
   Ported from nimClient.js (Vite project)
═══════════════════════════════════════════════════ */

import type { SourceItem } from '@/lib/storage'

interface StreamChatParams {
  messages:            Array<{ role: string; content: unknown }>
  model?:              string
  maxTokens?:          number
  temperature?:        number
  seed?:               number
  sessionId?:          string
  signal?:             AbortSignal
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
    seed = 0, sessionId, signal,
    onToken, onModelUsed, onSearchStart, onSearchDone, onSources, onModelUnavailable,
  } = params

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({
      messages,
      model,
      max_tokens:  maxTokens,
      temperature,
      seed,
      stream:      true,
      sessionId,
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
          const enriched: SourceItem[] = json.sources.map((s: { index: number; title: string; url: string; domain: string }) => ({
            ...s,
            favicon: s.domain ? `https://www.google.com/s2/favicons?domain=${s.domain}&sz=32` : '',
          }))
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
