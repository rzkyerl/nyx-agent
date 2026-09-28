import { NextRequest, NextResponse } from 'next/server'
import { resolveScrapeModel, scrapeWebPage } from '@/lib/web-scraper'
import type { CustomProvider } from '@/lib/storage'

export const maxDuration = 120

interface ScrapeRequest {
  url?: string
  instruction?: string
  model?: string
  customProviders?: CustomProvider[]
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as ScrapeRequest
  if (!body.url || !body.instruction || !body.model) {
    return NextResponse.json({ error: 'url, instruction, and model are required' }, { status: 400 })
  }

  try {
    const nimKey = process.env.NVIDIA_NIM_API_KEY || ''
    const groqKey = process.env.GROQ_API_KEY || ''
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || ''
    const result = await scrapeWebPage({
      url: body.url,
      instruction: body.instruction,
      model: resolveScrapeModel(body.model, nimKey, groqKey, geminiKey),
      nimKey,
      groqKey,
      geminiKey,
      customProviders: body.customProviders || [],
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = (error as Error).message || 'Web extraction failed.'
    console.warn('[scrape] Web extraction failed:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
