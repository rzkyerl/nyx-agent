import { chromium, type Browser } from 'playwright'
import { preprocess } from 'llm-scraper/dist/preprocess.js'
import type { CustomProvider } from './storage'

export { detectScrapeFollowUp, detectScrapeRequest, extractWebUrls, isBareUrlMessage } from './web-scraper-intent'

const MAX_CONTENT_CHARS = 40_000
const SCRAPE_TIMEOUT_MS = 45_000
const PAGE_TIMEOUT_MS = 60_000
const GITHUB_API_TIMEOUT_MS = 15_000

let browserPromise: Promise<Browser> | null = null

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ channel: 'chromium', headless: true }).catch(error => {
      browserPromise = null
      throw error
    })
  }
  return browserPromise
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost') || host === '::1') return true
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.')) return true
  if (host.startsWith('169.254.') || host.startsWith('0.')) return true
  const private172 = host.match(/^172\.(\d{1,3})\./)
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) return true
  return false
}

interface ScrapeCandidate {
  provider: 'nim' | 'groq' | 'gemini' | 'custom'
  model: string
  apiKey: string
  url: string
}

function resolveCandidate(modelId: string, nimKey: string, groqKey: string, geminiKey: string, customProviders: CustomProvider[]): ScrapeCandidate | null {
  if (modelId.startsWith('custom/')) {
    const parts = modelId.split('/')
    const provider = customProviders.find(item => item.id === parts[1])
    if (!provider) return null
    return {
      provider: 'custom',
      model: decodeURIComponent(parts.slice(2).join('/')),
      apiKey: provider.apiKey,
      url: `${provider.baseUrl.replace(/\/$/, '')}${provider.baseUrl.endsWith('/chat/completions') ? '' : provider.baseUrl.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'}`,
    }
  }
  if (modelId.startsWith('gemini/')) return geminiKey ? { provider: 'gemini', model: modelId.slice(7), apiKey: geminiKey, url: '' } : null
  if (modelId.startsWith('groq/')) return groqKey ? { provider: 'groq', model: modelId.slice(5), apiKey: groqKey, url: 'https://api.groq.com/openai/v1/chat/completions' } : null
  return nimKey ? { provider: 'nim', model: modelId, apiKey: nimKey, url: 'https://integrate.api.nvidia.com/v1/chat/completions' } : null
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try { return JSON.parse(cleaned) } catch { /* try the first JSON object or array below */ }
  const start = Math.min(...[cleaned.indexOf('{'), cleaned.indexOf('[')].filter(index => index >= 0))
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
  throw new Error('The model returned invalid JSON.')
}

function preparePageContent(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) return content

  const markers = [/\bREADME\b/i, /\bOverview\b/i, /\bDescription\b/i, /\bAbout\b/i]
  const markerIndex = markers
    .map(marker => content.search(marker))
    .filter(index => index >= 0 && index < 30_000)
    .sort((left, right) => left - right)[0]

  if (markerIndex !== undefined) {
    return content.slice(Math.max(0, markerIndex - 2_000), markerIndex - 2_000 + MAX_CONTENT_CHARS)
  }

  return content.slice(0, MAX_CONTENT_CHARS)
}

async function fetchGithubRepositoryContent(parsedUrl: URL): Promise<{ content: string; url: string } | null> {
  const match = parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\/|$)/)
  if (!match) return null

  const owner = match[1]
  const repository = match[2].replace(/\.git$/i, '')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS)
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'NyxAgent-web-scraper' }
    const repoResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, {
      headers,
      signal: controller.signal,
    })
    if (!repoResponse.ok) {
      if (repoResponse.status === 404) throw new Error('The GitHub repository is private or does not exist.')
      throw new Error(`GitHub API returned ${repoResponse.status}.`)
    }

    const repo = await repoResponse.json() as {
      full_name?: string
      name?: string
      description?: string | null
      html_url?: string
      language?: string | null
      stargazers_count?: number
      forks_count?: number
      topics?: string[]
    }

    const readmeResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/readme`, {
      headers: { ...headers, Accept: 'application/vnd.github.raw+json' },
      signal: controller.signal,
    })
    const readme = readmeResponse.ok ? await readmeResponse.text() : ''
    const metadata = [
      `Repository: ${repo.full_name || `${owner}/${repository}`}`,
      `Description: ${repo.description || 'No description provided.'}`,
      `Primary language: ${repo.language || 'Not specified'}`,
      `Stars: ${repo.stargazers_count ?? 0}`,
      `Forks: ${repo.forks_count ?? 0}`,
      `Topics: ${repo.topics?.join(', ') || 'None'}`,
      `URL: ${repo.html_url || parsedUrl.toString()}`,
    ].join('\n')

    return {
      content: `${metadata}\n\nREADME.md:\n${readme || 'No README.md was found in this repository.'}`,
      url: repo.html_url || parsedUrl.toString(),
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('GitHub API request timed out.')
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function extractWithProvider(candidate: ScrapeCandidate, content: string, instruction: string): Promise<unknown> {
  const preparedContent = preparePageContent(content)
  const isExplanation = /\b(apa itu|apa ini|ini apa|jelaskan|explain|what is|what does|project|repository|repo|website|site|ringkas|summarize|review)\b/i.test(instruction)
  const prompt = isExplanation
    ? `Analyze the webpage below and answer the user's question in clear Indonesian. Use only information present in the webpage. Explain what the project or website is, its purpose, main features, and useful technical details when available. Do not say you cannot access the page because the page content is provided below. Return a concise Markdown answer, not JSON.\n\nUser question: ${instruction.slice(0, 2_000)}\n\nWebpage content:\n${preparedContent}`
    : `Extract data from the webpage below according to the user's instruction. Return only valid JSON, with no Markdown fences or explanation. If the page does not contain a requested value, use null.\n\nUser instruction: ${instruction.slice(0, 2_000)}\n\nWebpage content:\n${preparedContent}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)
  try {
    const response = await fetch(candidate.provider === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${candidate.model}:generateContent?key=${encodeURIComponent(candidate.apiKey)}`
      : candidate.url, {
      method: 'POST',
      headers: candidate.provider === 'gemini'
        ? { 'Content-Type': 'application/json' }
        : { Authorization: `Bearer ${candidate.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate.provider === 'gemini'
        ? {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2_048, temperature: 0, ...(isExplanation ? {} : { responseMimeType: 'application/json' }) },
          }
        : {
            model: candidate.model,
            messages: [
              { role: 'system', content: isExplanation ? 'You analyze the supplied webpage content and answer the user. Never claim you cannot access the webpage.' : 'You extract webpage data and return strict JSON only.' },
              { role: 'user', content: prompt },
            ],
            max_tokens: 2_048,
            temperature: 0,
            stream: false,
          }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 240)
      throw new Error(`${candidate.provider} provider returned ${response.status}.${detail ? ` ${detail}` : ''}`)
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = candidate.provider === 'gemini'
      ? data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || ''
      : data.choices?.[0]?.message?.content || ''
    return isExplanation ? text.trim() : parseJson(text)
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`${candidate.provider} extraction timed out after ${SCRAPE_TIMEOUT_MS / 1000}s.`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function scrapeWebPage(options: {
  url: string
  instruction: string
  model: string
  nimKey: string
  groqKey: string
  geminiKey: string
  customProviders: CustomProvider[]
}): Promise<{ url: string; data: unknown; provider: string; model: string }> {
  const parsedUrl = new URL(options.url)
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || isPrivateHostname(parsedUrl.hostname)) {
    throw new Error('Only public HTTP(S) URLs can be scraped.')
  }

  const candidate = resolveCandidate(options.model, options.nimKey, options.groqKey, options.geminiKey, options.customProviders)
  if (!candidate) throw new Error('The selected provider is not available for scraping.')

  console.info(`[scrape] provider=${candidate.provider} model=${candidate.model} url=${parsedUrl.hostname}`)

  if (parsedUrl.hostname.toLowerCase() === 'github.com') {
    const githubContent = await fetchGithubRepositoryContent(parsedUrl)
    if (githubContent) {
      const data = await extractWithProvider(candidate, githubContent.content, options.instruction)
      return { url: githubContent.url, data, provider: candidate.provider, model: candidate.model }
    }
  }

const browser = await getBrowser()
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS)
  try {
    await page.goto(parsedUrl.toString(), { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS }).catch(async () => {
      // fallback: if networkidle times out, domcontentloaded already fired — continue anyway
      if (!page.url()) throw new Error('Failed to navigate to the URL.')
    })
    // extra wait for SPA hydration after networkidle
    await page.waitForTimeout(2_000).catch(() => {})
    const processed = await Promise.race([
      preprocess(page, { format: 'markdown' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The webpage took too long to process.')), PAGE_TIMEOUT_MS)),
    ])
const data = await extractWithProvider(candidate, processed.content, options.instruction)
    return { url: processed.url, data, provider: candidate.provider, model: candidate.model }
  } finally {
    await page.close()
    await context.close()
  }
}

export function resolveScrapeModel(model: string, nimKey: string, groqKey: string, geminiKey: string): string {
  if (model !== 'auto') return model
  if (groqKey) return 'groq/compound'
  if (geminiKey) return 'gemini/gemini-3.6-flash'
  if (nimKey) return 'openai/gpt-oss-20b'
  return model
}
