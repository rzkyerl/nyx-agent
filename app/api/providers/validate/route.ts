import { NextRequest, NextResponse } from 'next/server'

interface ValidationBody {
  baseUrl?: string
  apiKey?: string
}

interface ProviderModel {
  id: string
  name?: string
  owned_by?: string
}

function modelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/$/, '')
  if (normalized.endsWith('/models')) return normalized
  return `${normalized}${normalized.endsWith('/v1') ? '/models' : '/v1/models'}`
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as ValidationBody
  const baseUrl = body.baseUrl?.trim()
  const apiKey = body.apiKey?.trim()

  if (!baseUrl) return NextResponse.json({ valid: false, message: 'Base URL is required.' }, { status: 400 })
  // API key is optional — Ollama and some self-hosted providers don't require one

  const headers: Record<string, string> = {}
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  try {
    const response = await fetch(modelsUrl(baseUrl), {
      headers,
      signal: AbortSignal.timeout(15000),
    })
    if (response.ok) {
      const data = await response.json().catch(() => ({})) as { data?: ProviderModel[]; models?: ProviderModel[] }
      const models = (data.data || data.models || [])
        .filter(model => model?.id)
        .map(model => ({ id: model.id, label: model.name || model.id, description: model.owned_by ? `Provided by ${model.owned_by}` : 'Available model' }))
      return NextResponse.json({ valid: true, models })
    }
    // 401/403 means the endpoint is reachable but the key is wrong
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({ valid: false, message: `Authentication failed (${response.status}). Check your API key.` })
    }
    return NextResponse.json({ valid: false, message: `Provider returned ${response.status}. Check the base URL.` })
  } catch (error) {
    const err = error as Error
    if (err.name === 'TimeoutError') {
      return NextResponse.json({ valid: false, message: 'Provider check timed out (15 s). Make sure the tunnel is running and the URL is correct.' })
    }
    const detail = err.message?.includes('fetch') || err.message?.includes('ECONNREFUSED')
      ? 'Could not reach the provider. Is the tunnel active?'
      : `Could not reach the provider: ${err.message}`
    return NextResponse.json({ valid: false, message: detail })
  }
}
