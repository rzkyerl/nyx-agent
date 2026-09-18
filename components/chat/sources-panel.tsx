'use client'

import { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronUp, Globe } from 'lucide-react'
import type { SourceItem } from '@/lib/storage'

interface SourcesPanelProps { sources: SourceItem[] }

export function SourcesPanel({ sources }: SourcesPanelProps) {
  const [expanded, setExpanded] = useState(false)
  if (!sources || sources.length === 0) return null

  const INITIAL_VISIBLE = 3
  const hasMore  = sources.length > INITIAL_VISIBLE
  const visible  = expanded ? sources : sources.slice(0, INITIAL_VISIBLE)

  return (
    <div className="mt-3 rounded-xl border border-border/80 bg-card/40 p-3 shadow-[0_0_0_1px_rgba(148,163,184,0.06)]" role="complementary" aria-label="Sources">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map(src => <SourceCard key={src.index} source={src} />)}
      </div>

      {hasMore && (
        <button
          className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
          {expanded ? <><ChevronUp size={12} />Show less</> : <><ChevronDown size={12} />{sources.length - INITIAL_VISIBLE} more</>}
        </button>
      )}
    </div>
  )
}

function SourceCard({ source }: { source: SourceItem }) {
  const { index, title, url, domain, favicon } = source
  const [imgError, setImgError] = useState(false)

  const derivedDomain = domain || (() => {
    try { return new URL(url).hostname.replace(/^www\./, '') }
    catch { return '' }
  })()
  const resolvedLogo = favicon || (derivedDomain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(derivedDomain)}&sz=64` : '')

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 rounded-lg border border-border/60 bg-background/30 px-2.5 py-2.5 text-xs transition-colors hover:bg-muted/30"
      aria-label={`Source ${index}: ${title}`}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/70">
        {!imgError && resolvedLogo ? (
          <img src={resolvedLogo} alt="" className="h-full w-full object-cover" width={32} height={32} onError={() => setImgError(true)} aria-hidden />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Globe size={15} strokeWidth={2} />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium text-foreground group-hover:text-foreground">{title}</p>
          <ExternalLink size={11} className="mt-0.5 shrink-0 text-muted-foreground/80 transition-colors group-hover:text-foreground" aria-hidden />
        </div>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{derivedDomain || domain || url}</p>
      </div>
    </a>
  )
}
