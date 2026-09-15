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

const NIM_URL  = 'https://integrate.api.nvidia.com/v1/chat/completions'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

const TITLE_FALLBACK_MODELS = [
  { model: 'openai/gpt-oss-20b',                 provider: 'nim'  },
  { model: 'deepseek-ai/deepseek-v4-flash-0731', provider: 'nim'  },
  { model: 'groq/compound-mini',                 provider: 'groq' },
  { model: 'openai/gpt-oss-20b',                 provider: 'groq' },
]

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

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  const nimKey  = process.env.NVIDIA_NIM_API_KEY
  const groqKey = process.env.GROQ_API_KEY

  if (!nimKey && !groqKey) {
    return NextResponse.json({ title: message.slice(0, 40) + '...' })
  }

  const modelsToTry = TITLE_FALLBACK_MODELS.filter(m => {
    if (m.provider === 'nim')  return !!nimKey
    if (m.provider === 'groq') return !!groqKey
    return false
  })

  if (modelsToTry.length === 0) {
    return NextResponse.json({ title: message.slice(0, 40) + '...' })
  }

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
    const { model: tryModel, provider } = modelsToTry[i]
    const isLast  = i === modelsToTry.length - 1
    const apiKey  = provider === 'groq' ? groqKey! : nimKey!
    const apiUrl  = provider === 'groq' ? GROQ_URL : NIM_URL

    const generation = trace?.generation({
      name:       'title-completion',
      model:      tryModel,
      modelParameters: { provider, attemptIndex: String(i) },
      input:      messages,
      startTime:  new Date(),
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    }) ?? null

    try {
      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages:    messages,
          model:       tryModel,
          max_tokens:  30,
          temperature: 0.3,
          stream:      false,
        }),
      })

      if (!apiResponse.ok) {
        await apiResponse.text().catch(() => {})
        generation?.end({ output: `HTTP ${apiResponse.status}`, level: 'ERROR', statusMessage: `HTTP ${apiResponse.status}` })
        if (!isLast) continue
        await flushLangfuse()
        return NextResponse.json({ title: message.slice(0, 40) + '...' })
      }

      const data  = await apiResponse.json()
      const title = (data?.choices?.[0]?.message?.content as string | undefined)?.trim()
        || message.slice(0, 40) + '...'

      const usage = data?.usage
      generation?.end({
        output: title,
        ...(usage && {
          usageDetails: {
            input:  usage.prompt_tokens     ?? 0,
            output: usage.completion_tokens ?? 0,
            total:  usage.total_tokens      ?? 0,
          },
        }),
      })

      // Set trace output to the generated title
      trace?.update({ output: title.slice(0, 60) })

      await flushLangfuse()
      return NextResponse.json({ title: title.slice(0, 60) })

    } catch (error) {
      const errMsg = (error as Error).message
      console.error(`[title] ${provider}/${tryModel}:`, errMsg)
      generation?.end({ output: errMsg, level: 'ERROR', statusMessage: errMsg })
      if (!isLast) continue
      await flushLangfuse()
      return NextResponse.json({ title: message.slice(0, 40) + '...' })
    }
  }

  await flushLangfuse()
  return NextResponse.json({ title: message.slice(0, 40) + '...' })
}
