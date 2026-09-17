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
  if (!apiKey) return NextResponse.json({ valid: false, message: 'API key is required.' }, { status: 400 })

  try {
    const response = await fetch(modelsUrl(baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(7000),
    })
    if (response.ok) {
      const data = await response.json().catch(() => ({})) as { data?: ProviderModel[]; models?: ProviderModel[] }
      const models = (data.data || data.models || [])
        .filter(model => model?.id)
        .map(model => ({ id: model.id, label: model.name || model.id, description: model.owned_by ? `Provided by ${model.owned_by}` : 'Available model' }))
      return NextResponse.json({ valid: true, models })
    }
    return NextResponse.json({ valid: false, message: `Provider rejected the key (${response.status}).` })
  } catch (error) {
    const message = (error as Error).name === 'TimeoutError'
      ? 'Provider check timed out.'
      : 'Could not reach the provider.'
    return NextResponse.json({ valid: false, message })
  }
}
