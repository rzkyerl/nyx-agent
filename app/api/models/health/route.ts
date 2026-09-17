import { NextRequest, NextResponse } from 'next/server'

interface HealthRequest {
  models?: Array<{ id: string }>
  customProviders?: Array<{ id: string; baseUrl: string; apiKey: string; directConnection?: boolean }>
}

interface ModelHealth {
  id: string
  status: 'ready' | 'unavailable' | 'not-configured'
  latencyMs?: number
  message?: string
}

const PROVIDER_URLS: Record<string, string> = {
  nim: 'https://integrate.api.nvidia.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
}

function providerFor(modelId: string): { provider: string; model: string } {
  if (modelId.startsWith('custom/')) {
    const parts = modelId.split('/')
    return { provider: `custom:${parts[1]}`, model: decodeURIComponent(parts.slice(2).join('/')) }
  }
  if (modelId.startsWith('groq/')) return { provider: 'groq', model: modelId.slice(5) }
  if (modelId.startsWith('gemini/')) return { provider: 'gemini', model: modelId.slice(7) }
  if (modelId.startsWith('ollama/')) return { provider: 'ollama', model: modelId.slice(7) }
  return { provider: 'nim', model: modelId }
}

function providerKey(provider: string): string {
  if (provider === 'groq') return process.env.GROQ_API_KEY || ''
  if (provider === 'gemini') return process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || ''
  if (provider === 'ollama') return process.env.OLLAMA_BASE_URL || ''
  return process.env.NVIDIA_NIM_API_KEY || ''
}

async function checkModel(id: string, customProviders: NonNullable<HealthRequest['customProviders']>): Promise<ModelHealth> {
  if (id === 'auto') {
    const configured = Boolean(process.env.NVIDIA_NIM_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.OLLAMA_BASE_URL)
    return configured
      ? { id, status: 'ready', message: 'Uses the first available provider' }
      : { id, status: 'not-configured', message: 'No provider is configured' }
  }
  const { provider, model } = providerFor(id)
  const customProvider = provider.startsWith('custom:') ? customProviders.find(item => item.id === provider.slice(7)) : undefined
  if (customProvider?.directConnection) return { id, status: 'not-configured', message: 'Use direct connection from the browser' }
  const key = customProvider?.apiKey || providerKey(provider)
  if (!key) return { id, status: 'not-configured', message: `${provider} is not configured` }

  const started = Date.now()
  try {
    if (provider === 'ollama') {
      const response = await fetch(`${process.env.OLLAMA_BASE_URL!.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: 'ping', stream: false, options: { num_predict: 1 } }),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) return { id, status: 'unavailable', latencyMs: Date.now() - started, message: `Ollama returned ${response.status}` }
      return { id, status: 'ready', latencyMs: Date.now() - started }
    }

    const customUrl = customProvider ? `${customProvider.baseUrl.replace(/\/$/, '')}${customProvider.baseUrl.endsWith('/chat/completions') ? '' : customProvider.baseUrl.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'}` : ''
    const response = await fetch(provider === 'gemini'
      ? `${PROVIDER_URLS.gemini}/${model}:generateContent?key=${encodeURIComponent(key)}`
      : customProvider ? customUrl : PROVIDER_URLS[provider], {
      method: 'POST',
      headers: provider === 'gemini'
        ? { 'Content-Type': 'application/json' }
        : { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: provider === 'gemini'
        ? JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            generationConfig: { maxOutputTokens: 1, temperature: 0 },
          })
        : JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            temperature: 0,
            stream: false,
          }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return { id, status: 'unavailable', latencyMs: Date.now() - started, message: `Provider returned ${response.status}` }
    return { id, status: 'ready', latencyMs: Date.now() - started }
  } catch (error) {
    return { id, status: 'unavailable', latencyMs: Date.now() - started, message: (error as Error).name === 'TimeoutError' ? 'Request timed out' : 'Provider is unreachable' }
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as HealthRequest
  const ids = (body.models || []).map(model => model.id).filter(Boolean).slice(0, 50)
  const results = await Promise.all(ids.map(id => checkModel(id, body.customProviders || [])))
  return NextResponse.json({ results })
}