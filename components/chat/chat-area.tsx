'use client'

/* ═══════════════════════════════════════════════════
   ChatArea — Message list with auto-scroll + empty state
   Ported from ChatArea.jsx (Vite project)
═══════════════════════════════════════════════════ */

import { useRef, useEffect, useState, type ReactNode } from 'react'
import { Message }  from './message'
import type { ChatMessage } from '@/lib/storage'

interface ChatAreaProps {
  messages:       ChatMessage[]
  isGenerating:   boolean
  isSearching:    boolean
  searchDone:     boolean
  searchQuery:    string
  haluWarningMsgId: string | null
  onSuggestionClick: (prompt: string) => void
  onRegenerate?:  (msg: ChatMessage) => void
  onRetryAssistant?: (msg: ChatMessage) => void
  onEdit?:        (msg: ChatMessage, content: string) => void
  onLike?:        (msg: ChatMessage, val: 'like' | null) => void
  onDislike?:     (msg: ChatMessage, val: 'dislike' | null) => void
  onShare?:       (msg: ChatMessage, ok: boolean) => void
  toolbar?:       ReactNode
  hasExperimentalModel?: boolean
}

export function ChatArea({
  messages, isGenerating, isSearching, searchDone, searchQuery,
  haluWarningMsgId, onSuggestionClick,
  onRegenerate, onRetryAssistant, onEdit, onLike, onDislike, onShare, toolbar,
  hasExperimentalModel = false,
}: ChatAreaProps) {
  const scrollRef   = useRef<HTMLDivElement>(null)
  const isAtBottom  = useRef(true)
  const rafRef      = useRef<number | null>(null)
  const prevLengthRef = useRef(0)

  const [indicatorVisible, setIndicatorVisible] = useState(false)
  const [indicatorLeaving, setIndicatorLeaving] = useState(false)

  const showSearchIndicator = isSearching || searchDone

  useEffect(() => {
    if (showSearchIndicator) {
      setIndicatorLeaving(false); setIndicatorVisible(true); return
    }
    if (!indicatorVisible) return
    setIndicatorLeaving(true)
    const t = setTimeout(() => { setIndicatorVisible(false); setIndicatorLeaving(false) }, 280)
    return () => clearTimeout(t)
  }, [showSearchIndicator, indicatorVisible])

  // Track scroll position
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => { isAtBottom.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 64 }
    const onUser   = () => { if ((el.scrollHeight - el.scrollTop - el.clientHeight) > 64) isAtBottom.current = false }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onUser, { passive: true })
    el.addEventListener('touchmove', onUser, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); el.removeEventListener('wheel', onUser); el.removeEventListener('touchmove', onUser) }
  }, [])

  // Auto-scroll during streaming
  useEffect(() => {
    if (!isGenerating || !isAtBottom.current) return
    const el = scrollRef.current
    if (!el) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }, [messages, isGenerating])

  // Jump to bottom on new message
  useEffect(() => {
    const newMsg = messages.length > prevLengthRef.current
    prevLengthRef.current = messages.length
    if (!newMsg) return
    const el = scrollRef.current
    if (!el) return
    isAtBottom.current = true
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  let lastUserMsgIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { lastUserMsgIndex = i; break } }
  let lastAiMsgIndex   = -1
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'assistant') { lastAiMsgIndex = i; break } }

  if (!messages || messages.length === 0) {
    return (
      <div className="relative flex min-h-0 flex-1">
        {toolbar}
        <div ref={scrollRef} className="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <EmptyState onSuggestionClick={onSuggestionClick} />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      {toolbar}
      <div ref={scrollRef} className="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <div className={hasExperimentalModel
          ? 'mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-48 pt-20 md:pb-44 md:pt-20'
          : 'mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-36 pt-20 md:pb-36 md:pt-20'}>
          {messages.map((msg, i) => (
            <Message
              key={msg.id}
              message={msg}
              isGenerating={isGenerating}
              isLastUser={i === lastUserMsgIndex && !isGenerating}
              isStreaming={isGenerating && i === lastAiMsgIndex}
              showHaluWarning={haluWarningMsgId === msg.id}
              onRegenerate={onRegenerate}
              onRetryAssistant={onRetryAssistant}
              onEdit={onEdit}
              onLike={onLike}
              onDislike={onDislike}
              onShare={onShare}
            />
          ))}

          {indicatorVisible && (
            <SearchIndicator
              query={searchQuery}
              done={searchDone && !isSearching}
              leaving={indicatorLeaving}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Search indicator ──────────────────────────────
function SearchIndicator({ query, done, leaving }: { query: string; done: boolean; leaving: boolean }) {
  return (
    <div
      className={[
        'flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground transition-opacity duration-300',
        leaving ? 'opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      {done ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      )}
      <span>
        {done ? 'Results found, composing answer...' : `Searching for: "${query || '...'}"`}
      </span>
      {!done && (
        <span className="flex gap-1">
          {[0,1,2].map(i => (
            <span key={i} className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      )}
    </div>
  )
}


function getGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5  && h < 12) return 'Good Morning'
  if (h >= 12 && h < 15) return 'Good Afternoon'
  if (h >= 15 && h < 19) return 'Good Evening'
  return 'Good Night'
}

function EmptyState({ onSuggestionClick }: { onSuggestionClick: (p: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 pt-24 text-center md:pt-16">
      <div className="flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/nyx-agent/logo-agent-chat.png"
          alt="Nyx Agent"
          width={140}
          height={140}
          className="h-80 w-80 object-contain"
        />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-foreground">{getGreeting()}, welcome to Nyx Agent!</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ask anything or upload a file Nyx Agent is ready.</p>
      </div>
    </div>
  )
}
