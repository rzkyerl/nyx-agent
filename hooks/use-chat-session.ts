'use client'

/* ═══════════════════════════════════════════════════
   useChatSession — Session management via localStorage
   Ported from useChatSession.js (Vite project)
═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  loadSessions,
  saveSessions,
  loadActiveId,
  saveActiveId,
  loadSettings,
  saveSettings,
  genId,
  DEFAULT_SETTINGS,
  type ChatSession,
  type ChatMessage,
  type ChatSettings,
  type ChatFile,
  type SourceItem,
} from '@/lib/storage'

export function useChatSession() {
  const [sessions, setSessions]         = useState<ChatSession[]>([])
  const [activeId, setActiveId]         = useState<string | null>(null)
  const [settings, setSettings]         = useState<ChatSettings>(DEFAULT_SETTINGS)
  const [isGenerating, setIsGenerating] = useState(false)
  const abortRef                        = useRef<AbortController | null>(null)
  const [hydrated, setHydrated]         = useState(false)

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => {
    setSessions(loadSessions())
    setActiveId(loadActiveId())
    setSettings(loadSettings())
    setHydrated(true)
  }, [])

  // Persist sessions
  useEffect(() => {
    if (hydrated) saveSessions(sessions)
  }, [sessions, hydrated])

  // Persist active ID
  useEffect(() => {
    if (hydrated) saveActiveId(activeId)
  }, [activeId, hydrated])

  // Persist settings
  useEffect(() => {
    if (hydrated) saveSettings(settings)
  }, [settings, hydrated])

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'nyx-sessions') setSessions(loadSessions())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const activeSession = sessions.find(s => s.id === activeId) || null

  /* ── Create new session ── */
  const createSession = useCallback((): ChatSession => {
    const now = Date.now()
    const session: ChatSession = {
      id:        genId('sess'),
      title:     'New Chat',
      createdAt: now,
      updatedAt: now,
      messages:  [],
    }
    setActiveId(session.id)
    return session
  }, [])

  /* ── Delete session ── */
  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      if (id === activeId) {
        setActiveId(next.length > 0 ? next[0].id : null)
      }
      return next
    })
  }, [activeId])

  /* ── Rename session ── */
  const renameSession = useCallback((id: string, title: string) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s))
  }, [])

  const togglePinSession = useCallback((id: string) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s))
  }, [])

  /* ── Switch active session ── */
  const switchSession = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  /* ── Add message to a session ── */
  const addMessage = useCallback((
    sessionId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'>
  ): ChatMessage => {
    const msg: ChatMessage = {
      id:        genId('msg'),
      timestamp: Date.now(),
      ...message,
    }
    setSessions(prev => {
      const existing = prev.find(session => session.id === sessionId)
      if (!existing) {
        const now = Date.now()
        return [{
          id: sessionId,
          title: 'New Chat',
          createdAt: now,
          updatedAt: now,
          messages: [msg],
        }, ...prev]
      }
      return prev.map(s => s.id === sessionId
        ? { ...s, messages: [...s.messages, msg], updatedAt: Date.now() }
        : s
      )
    })
    return msg
  }, [])

  /* ── Update message content (streaming) ── */
  const updateMessage = useCallback((
    sessionId: string,
    msgId: string,
    content: string | null,
    meta: Partial<Pick<ChatMessage, 'sources' | 'failed'>> = {}
  ) => {
    setSessions(prev =>
      prev.map(s => {
        if (s.id !== sessionId) return s
        const messages = s.messages.map(m => {
          if (m.id !== msgId) return m
          const updated = { ...m, ...meta }
          if (content !== null && content !== undefined) updated.content = content
          return updated
        })
        return { ...s, messages, updatedAt: Date.now() }
      })
    )
  }, [])

  const trimMessagesFrom = useCallback((sessionId: string, messageId: string) => {
    setSessions(prev => prev.map(session => {
      if (session.id !== sessionId) return session
      const messageIndex = session.messages.findIndex(message => message.id === messageId)
      if (messageIndex < 0) return session
      return {
        ...session,
        messages: session.messages.slice(0, messageIndex),
        updatedAt: Date.now(),
      }
    }))
  }, [])

  /* ── Clear all sessions ── */
  const clearAll = useCallback(() => {
    setSessions([])
    setActiveId(null)
  }, [])

  /* ── Update settings ── */
  const updateSettings = useCallback((patch: Partial<ChatSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }))
  }, [])

  return {
    sessions,
    activeId,
    activeSession,
    settings,
    isGenerating,
    setIsGenerating,
    abortRef,
    hydrated,
    createSession,
    deleteSession,
    renameSession,
    togglePinSession,
    switchSession,
    addMessage,
    updateMessage,
    trimMessagesFrom,
    clearAll,
    updateSettings,
  }
}

export type { ChatSession, ChatMessage, ChatSettings, ChatFile, SourceItem }
