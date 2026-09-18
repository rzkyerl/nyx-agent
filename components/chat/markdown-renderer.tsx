'use client'

/* ═══════════════════════════════════════════════════
   MarkdownRenderer — marked + DOMPurify + hljs
   Ported from MarkdownRenderer.jsx (Vite project)
   Client-only (uses DOMPurify / browser DOM)
═══════════════════════════════════════════════════ */

import { useRef, useEffect, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'

// Register languages
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python     from 'highlight.js/lib/languages/python'
import json       from 'highlight.js/lib/languages/json'
import bash       from 'highlight.js/lib/languages/bash'
import xml        from 'highlight.js/lib/languages/xml'
import css        from 'highlight.js/lib/languages/css'
import sql        from 'highlight.js/lib/languages/sql'
import go         from 'highlight.js/lib/languages/go'
import rust       from 'highlight.js/lib/languages/rust'
import java       from 'highlight.js/lib/languages/java'
import yaml       from 'highlight.js/lib/languages/yaml'
import markdown   from 'highlight.js/lib/languages/markdown'

hljs.registerLanguage('javascript', javascript); hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript); hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('jsx', javascript);        hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('python', python);         hljs.registerLanguage('py', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash);             hljs.registerLanguage('sh', bash); hljs.registerLanguage('shell', bash)
hljs.registerLanguage('html', xml);              hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css);               hljs.registerLanguage('sql', sql)
hljs.registerLanguage('go', go);                 hljs.registerLanguage('rust', rust); hljs.registerLanguage('rs', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('yaml', yaml);             hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('markdown', markdown);     hljs.registerLanguage('md', markdown)

marked.setOptions({ breaks: true, gfm: true })

// ── Code block renderer ──────────────────────────
const renderer = new marked.Renderer()
// Override code renderer — marked v13+ passes a Code token object
;(renderer as unknown as { code: (token: unknown) => string }).code = function(token: unknown) {
  let codeText = '', lang = ''
  if (token && typeof token === 'object') {
    const t = token as { text?: string; lang?: string }
    codeText = t.text || ''
    lang = t.lang || ''
  } else if (typeof token === 'string') {
    codeText = token
  }

  codeText = codeText
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

  let highlighted = codeText
  if (lang && hljs.getLanguage(lang)) {
    try { highlighted = hljs.highlight(codeText, { language: lang }).value } catch { /* noop */ }
  } else {
    try { highlighted = hljs.highlightAuto(codeText).value } catch { /* noop */ }
  }

  const langLabel = lang || 'text'
  const escaped   = codeText.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${langLabel}</span><button class="md-code-copy" data-code="${escaped}">Copy</button></div><pre><code class="hljs language-${langLabel}">${highlighted}</code></pre></div>`
}
;(renderer as unknown as { table: (token: unknown) => string }).table = function(this: {
  tablecell: (cell: unknown) => string
  tablerow: (row: { text: string }) => string
}, token: unknown) {
  const tableToken = token as { header?: Array<{ text?: string }>; rows?: unknown[] }
  const header = (tableToken.header || []).map(cell => this.tablecell(cell)).join('')
  const rows = (tableToken.rows || []).map(row => this.tablerow({
    text: (row as unknown[]).map(cell => this.tablecell(cell)).join(''),
  })).join('')
  const firstHeader = tableToken.header?.[0]?.text?.trim().toLowerCase() || ''
  const hasNumberColumn = /^(no\.?|nomor|number|#)$/.test(firstHeader)
  const tableClass = hasNumberColumn ? ' typeset-numbered-table' : ''
  return `<div class="typeset-scroll"><table class="${tableClass.trim()}"><thead>${this.tablerow({ text: header })}</thead><tbody>${rows}</tbody></table></div>`
}
marked.use({ renderer })

// ── Source types ─────────────────────────────────
interface Source {
  index:   number
  title:   string
  url:     string
  domain:  string
  favicon?: string
}

// ── Source map builder ───────────────────────────
function buildSourceMap(sources: Source[]) {
  const byIndex  = new Map<number, Source>()
  const byUrl    = new Map<string, Source>()
  const byDomain = new Map<string, Source>()
  if (!Array.isArray(sources)) return { byIndex, byUrl, byDomain }
  for (const s of sources) {
    if (!s) continue
    const idx = Number(s.index)
    if (!isNaN(idx)) byIndex.set(idx, s)
    if (s.url)    byUrl.set(s.url.replace(/\/$/, ''), s)
    if (s.domain) byDomain.set(s.domain, s)
  }
  return { byIndex, byUrl, byDomain }
}

function makePill(src: Source, citeNum: number | null): string {
  const letter   = (src.domain || src.url || '?').charAt(0).toUpperCase()
  const domain   = (src.domain || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const url      = (src.url || '').replace(/"/g, '%22')
  const favicon  = (src.favicon || `https://www.google.com/s2/favicons?domain=${src.domain}&sz=32`).replace(/"/g, '%22')
  const citeAttr = citeNum != null ? ` data-cite="${citeNum}"` : ''
  return `<a class="md-cite" href="${url}" target="_blank" rel="noopener noreferrer"${citeAttr} data-favicon="${favicon}"><span class="md-cite-icon" style="background-image:url('${favicon}')">${letter}</span><span class="md-cite-domain">${domain}</span></a>`
}

function injectCitations(html: string, sourceMap: ReturnType<typeof buildSourceMap>): string {
  const { byIndex, byUrl, byDomain } = sourceMap
  const CODE_RE = /(<div class="md-code-block">[\s\S]*?<\/div>)/g
  const parts   = html.split(CODE_RE)

  return parts.map((part, i) => {
    if (i % 2 === 1) return part

    let out = part.replace(/\[(\d+)\]/g, (_, num) => {
      const n   = parseInt(num, 10)
      const src = byIndex.get(n)
      return src ? makePill(src, n) : `<span class="md-cite md-cite-plain">${n}</span>`
    })

    if (byUrl.size > 0 || byDomain.size > 0) {
      out = out.replace(/<a\s[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, (match, href) => {
        if (match.includes('class="md-cite"')) return match
        const normalised = href.replace(/\/$/, '')
        let src = byUrl.get(normalised)
        if (!src) {
          try { const d = new URL(href).hostname.replace(/^www\./, ''); src = byDomain.get(d) } catch { /* noop */ }
        }
        return src ? makePill(src, null) : match
      })
      out = out.replace(/(?<![="'(])https?:\/\/[^\s<>"')]+/g, (url) => {
        const normalised = url.replace(/\/$/, '')
        let src = byUrl.get(normalised)
        if (!src) {
          try { const d = new URL(url).hostname.replace(/^www\./, ''); src = byDomain.get(d) } catch { /* noop */ }
        }
        return src ? makePill(src, null) : url
      })
    }
    return out
  }).join('')
}

// ── Strip "Sumber/Sources" block ─────────────────
const SOURCES_BLOCK_RE = new RegExp(
  '(?:^|\\n)' +
  '[ \\t]*(?:\\*{1,2}|#{1,3})?[ \\t]*' +
  '(?:Sources?|Sumber(?:\\s+Referensi)?|Referensi|References?|Daftar\\s+Pustaka)' +
  '[ \\t]*:?[ \\t]*(?:\\*{1,2})?[ \\t]*' +
  '(?:\\n|$)' +
  '[\\s\\S]*$',
  'im'
)

function stripSourcesBlock(text: string): string {
  return text.replace(SOURCES_BLOCK_RE, '').trimEnd()
}

// ── Component ─────────────────────────────────────
interface MarkdownRendererProps {
  content:      string
  isStreaming?: boolean
  sources?:     Source[]
}

export function MarkdownRenderer({ content, isStreaming = false, sources = [] }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sourceMap    = useMemo(() => buildSourceMap(sources), [sources])

  const renderedHtml = useMemo(() => {
    const md = content || ''
    if (!md) return ''
    try {
      const cleaned   = stripSourcesBlock(md)
      const streamMarker = 'NYX_STREAM_CURSOR_TOKEN'
      const raw       = marked.parse(isStreaming ? cleaned + streamMarker : cleaned, { async: false }) as string
      const withCites = injectCitations(raw, sourceMap)
      const sanitized = DOMPurify.sanitize(withCites, {
        ADD_ATTR:        ['data-code', 'data-cite', 'data-favicon', 'target', 'rel'],
        ADD_TAGS:        ['span'],
        ALLOW_DATA_ATTR: true,
      })
      if (!isStreaming) return sanitized
      const marker = sanitized.indexOf(streamMarker)
      const cursor = '<span class="chat-stream-cursor" aria-hidden="true"></span>'
      return marker >= 0
        ? sanitized.replace(streamMarker, cursor)
        : sanitized + cursor
    } catch {
      return DOMPurify.sanitize(content || '')
    }
  }, [content, sourceMap, isStreaming])

  // Post-render: code copy buttons + favicon loading
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const handlers: Array<{ el: Element; handler: () => void }> = []

    root.querySelectorAll('.md-code-copy').forEach(btn => {
      const handler = async () => {
        const raw = (btn.getAttribute('data-code') || '')
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        try { await navigator.clipboard.writeText(raw) } catch {
          const ta = document.createElement('textarea')
          ta.value = raw; document.body.appendChild(ta); ta.select()
          document.execCommand('copy'); document.body.removeChild(ta)
        }
        const orig = btn.textContent || 'Copy'
        btn.textContent = 'Copied!'; btn.classList.add('copied')
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied') }, 2000)
      }
      btn.addEventListener('click', handler)
      handlers.push({ el: btn, handler })
    })

    root.querySelectorAll('.md-cite[data-favicon]').forEach(chip => {
      const url    = chip.getAttribute('data-favicon')
      const iconEl = chip.querySelector('.md-cite-icon')
      if (!iconEl || !url) return
      const img  = new Image()
      img.onload  = () => { (iconEl as HTMLElement).style.backgroundImage = `url(${url})`; iconEl.classList.add('has-favicon') }
      img.onerror = () => iconEl.classList.add('letter-fallback')
      img.src     = url
    })

    root.querySelectorAll('a[href]:not(.md-cite)').forEach(a => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })

    return () => handlers.forEach(({ el, handler }) => el.removeEventListener('click', handler))
  }, [renderedHtml])

  return (
    <div
      ref={containerRef}
      className="md-body prose prose-sm dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  )
}
