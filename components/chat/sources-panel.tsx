'use client'

import { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import type { SourceItem } from '@/lib/storage'

interface SourcesPanelProps { sources: SourceItem[] }

export function SourcesPanel({ sources }: SourcesPanelProps) {
  const [expanded, setExpanded] = useState(false)
  if (!sources || sources.length === 0) return null

  const INITIAL_VISIBLE = 3
  const hasMore  = sources.length > INITIAL_VISIBLE
  const visible  = expanded ? sources : sources.slice(0, INITIAL_VISIBLE)

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3" role="complementary" aria-label="Sources">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        {sources.length} source{sources.length !== 1 ? 's' : ''}
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(src => <SourceCard key={src.index} source={src} />)}
      </div>

      {hasMore && (
        <button
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
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

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-2 rounded-md border border-border bg-background p-2 text-xs hover:bg-muted transition-colors"
      aria-label={`Source ${index}: ${title}`}
    >
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{title}</p>
        <p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
          {favicon && !imgError ? (
            <img src={favicon} alt="" className="h-3 w-3" width={12} height={12} onError={() => setImgError(true)} aria-hidden />
          ) : (
            <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-muted text-[8px] font-bold" aria-hidden>
              {domain.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="truncate">{domain}</span>
        </p>
      </div>
      <ExternalLink size={10} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  )
}
