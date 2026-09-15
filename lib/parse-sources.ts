/* ═══════════════════════════════════════════════════
   Nyx Agent — Source parser
   Extracts structured source data from AI message text
═══════════════════════════════════════════════════ */

import type { SourceItem } from './storage'

const HEADING_RE = new RegExp(
  '(?:^|\\n)' +
  '[ \\t]*(?:\\*{1,2}|#{1,3})?[ \\t]*' +
  '(?:Sources?|Sumber(?:\\s+Referensi)?|Referensi|References?|Daftar\\s+Pustaka)' +
  '[ \\t]*:?[ \\t]*(?:\\*{1,2})?[ \\t]*' +
  '(?:\\n|$)',
  'im'
)

export function parseSources(content: string): { body: string; sources: SourceItem[] } {
  if (!content) return { body: '', sources: [] }

  const match = content.match(HEADING_RE)
  if (!match) return { body: content, sources: [] }

  const splitAt     = content.indexOf(match[0])
  const body        = content.slice(0, splitAt).trimEnd()
  const sourceBlock = content.slice(splitAt + match[0].length)

  const sources: SourceItem[] = []

  for (const line of sourceBlock.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (/^#{1,4}\s/.test(t) || (/^\*{2}[^*]/.test(t) && !t.includes('http'))) break

    let index: number | null = null
    let title = ''
    let url   = ''

    const prefixMatch = t.match(/^(?:\[(\d+)\]|(\d+)[.)]) ?(.*)$/)
    if (prefixMatch) {
      index = parseInt(prefixMatch[1] || prefixMatch[2], 10)
      const rest = (prefixMatch[3] || '').trim()

      const mdLink = rest.match(/^\[(.+?)\]\((https?:\/\/[^\s)]+)\)/)
      if (mdLink) {
        title = mdLink[1].trim()
        url   = mdLink[2].trim()
      } else {
        const dashSplit = rest.match(/^(.*?)\s+[-–—]\s+(https?:\/\/\S+)\s*$/)
        if (dashSplit) {
          title = dashSplit[1].trim()
          url   = dashSplit[2].trim()
        } else {
          const urlMatch = rest.match(/(https?:\/\/\S+)/)
          if (urlMatch) {
            url   = urlMatch[1]
            title = rest.replace(urlMatch[0], '').replace(/[-–—\s]+$/, '').trim()
          }
        }
      }
    }

    if (!url || index === null) continue

    let domain  = ''
    let favicon = ''
    try {
      domain  = new URL(url).hostname.replace(/^www\./, '')
      favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    } catch { domain = url }

    title = title.replace(/https?:\/\/\S+/g, '').replace(/[-–—\s]+$/, '').trim()
    if (!title) title = domain

    if (!sources.find(s => s.index === index)) {
      sources.push({ index, title, url, domain, favicon })
    }
  }

  return { body, sources }
}
