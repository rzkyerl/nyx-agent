'use client'

/* ═══════════════════════════════════════════════════
   NyxChat — Root client component (replaces template Chat)
   Wires: useChatSession + useStreamChat + all sub-components
═══════════════════════════════════════════════════ */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Menu, Trash2, ChevronDown, Share2, FileText, Pin, Edit3 } from 'lucide-react'
import { Sidebar }       from './sidebar'
import { ChatArea }      from './chat-area'
import { Composer }      from './composer'
import { SettingsPanel }  from './settings-panel'
import { WelcomeModal }  from './welcome-modal'
import { useChatSession } from '@/hooks/use-chat-session'
import { streamChatCompletion, buildApiMessages, detectHallucinationWarning } from '@/hooks/use-stream-chat'
import { NIM_MODELS } from '@/lib/models'
import { loadCustomProviders, type ChatMessage, type CustomProvider, type SourceItem } from '@/lib/storage'
import type { NyxModel } from '@/lib/models'
import type { InstalledSkill } from '@/lib/skills'
import { parseExportConfig } from '@/hooks/use-export-file'
import { cn } from '@/lib/utils'

export function NyxChat() {
  const {
    sessions, activeId, activeSession, settings,
    isGenerating, setIsGenerating, abortRef, hydrated,
    createSession, deleteSession, renameSession, togglePinSession, switchSession,
    addMessage, updateMessage, trimMessagesFrom, clearAll, updateSettings,
  } = useChatSession()

  const [sidebarOpen, setSidebarOpen]     = useState(true)
  const [settingsOpen, setSettingsOpen]   = useState(false)
  const [modelUnavailable, setModelUnavailable] = useState<string | null>(null)
  const [titleMenuOpen, setTitleMenuOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [previewOpen, setPreviewOpen]   = useState(false)
  const [previewWidth, setPreviewWidth] = useState(640)
  const [previewDragging, setPreviewDragging] = useState(false)
  const [isSearching, setIsSearching]     = useState(false)
  const [searchDone, setSearchDone]       = useState(false)
  const [searchQuery, setSearchQuery]     = useState('')
  const [activeSkillNames, setActiveSkillNames] = useState<string[]>([])
  const [haluWarningMsgId, setHaluWarningMsgId] = useState<string | null>(null)
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>(() => loadCustomProviders())
  const [showWelcome, setShowWelcome]         = useState(false)

  const titleMenuRef      = useRef<HTMLDivElement>(null)
  const titleInputRef     = useRef<HTMLInputElement>(null)
  const sessionsRef       = useRef(sessions)
  const activeSessionRef  = useRef(activeSession)

  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  useEffect(() => { activeSessionRef.current = activeSession }, [activeSession])
  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [editingTitle])

  useEffect(() => {
    const handlePreviewChange = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean; width?: number; dragging?: boolean } | boolean>).detail
      if (typeof detail === 'boolean') {
        setPreviewOpen(detail)
        setPreviewDragging(false)
        return
      }
      setPreviewOpen(detail.open === true)
      if (typeof detail.width === 'number') setPreviewWidth(detail.width)
      setPreviewDragging(detail.dragging === true)
    }
    window.addEventListener('nyx-preview-change', handlePreviewChange)
    return () => window.removeEventListener('nyx-preview-change', handlePreviewChange)
  }, [])

  const messages       = activeSession?.messages || []
  const customModels = useMemo<NyxModel[]>(() => customProviders.flatMap(provider => provider.models.map(model => ({
    id: `custom/${provider.id}/${encodeURIComponent(model.id)}`,
    label: model.label,
    vendor: provider.name,
    description: model.description || `Custom model via ${provider.baseUrl}`,
    tags: ['Custom'],
  }))), [customProviders])
  const availableModels = useMemo(() => [...NIM_MODELS, ...customModels], [customModels])
  const selectedModelId = settings.selectedModel || NIM_MODELS[0].id
  const selectedModel = availableModels.find(model => model.id === selectedModelId)
  const hasGeneratedDocument = messages.some(message => message.role === 'assistant' && Boolean(parseExportConfig(message.content)))
  const generatedDocuments = messages
    .filter(message => message.role === 'assistant')
    .map(message => ({ message, config: parseExportConfig(message.content) }))
    .filter((item): item is { message: ChatMessage; config: NonNullable<ReturnType<typeof parseExportConfig>> } => item.config !== null)

  const handleShareSession = useCallback((session: { title: string }) => {
    void session
    setShareOpen(true)
    setArtifactsOpen(false)
    setTitleMenuOpen(false)
  }, [])

  const handleShareChat = useCallback(() => {
    handleShareSession(activeSession || { title: 'Nyx Agent conversation' })
  }, [activeSession, handleShareSession])

  const copyChatLink = useCallback(async () => {
    await navigator.clipboard?.writeText(window.location.href)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }, [])

  const startHeaderRename = useCallback(() => {
    if (!activeId || !activeSession) return
    setTitleValue(activeSession.title)
    setEditingTitle(true)
    setTitleMenuOpen(false)
  }, [activeId, activeSession])

  const commitHeaderRename = useCallback(() => {
    if (activeId && titleValue.trim()) renameSession(activeId, titleValue.trim())
    setEditingTitle(false)
    setTitleValue('')
  }, [activeId, renameSession, titleValue])

  const cancelHeaderRename = useCallback(() => {
    setEditingTitle(false)
    setTitleValue('')
  }, [])

  const handleTitleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); commitHeaderRename() }
    if (event.key === 'Escape') { event.preventDefault(); cancelHeaderRename() }
  }, [cancelHeaderRename, commitHeaderRename])

  // Reset menu state on session switch
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setConfirmDelete(false)
      setTitleMenuOpen(false)
      cancelHeaderRename()
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, cancelHeaderRename])

  // Close conv menu on outside click
  useEffect(() => {
    if (!titleMenuOpen) return
    const h = (e: MouseEvent) => {
      if (titleMenuRef.current && !titleMenuRef.current.contains(e.target as Node)) setTitleMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [titleMenuOpen])

  /* ── Generate title via AI ── */
  const generateTitle = useCallback(async (conversationSummary: string, sessionId?: string) => {
    try {
      const resp = await fetch('/api/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: conversationSummary, sessionId, model: selectedModelId, customProviders }),
      })
      if (!resp.ok) return null
      const data = await resp.json()
      return (data.title as string) || null
    } catch { return null }
  }, [customProviders, selectedModelId])

  /* ── Update memory via AI (background, fire-and-forget) ── */
  const updateMemory = useCallback(async (userMessage: string, assistantReply: string) => {
    if (!settings.memoryEnabled) return
    try {
      const resp = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage,
          assistantReply,
          currentMemory: settings.memory,
          model: selectedModelId,
          customProviders,
        }),
      })
      if (!resp.ok) return
      const data = await resp.json() as { memory?: string }
      if (typeof data.memory === 'string' && data.memory !== settings.memory) {
        updateSettings({ memory: data.memory })
      }
    } catch { /* silent — memory update is non-critical */ }
  }, [settings.memoryEnabled, settings.memory, selectedModelId, customProviders, updateSettings])

  /* ── New chat ── */
  const handleNewChat = useCallback(() => {
    setModelUnavailable(null)
    createSession()
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }, [createSession])

  /* ── Switch session ── */
  const handleSwitch = useCallback((id: string) => {
    setModelUnavailable(null)
    switchSession(id)
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }, [switchSession])

  /* ── Rename handlers ── */
  /* ── Delete active ── */
  const handleDeleteActive = useCallback(() => {
    if (!activeId) return
    if (confirmDelete) { deleteSession(activeId); setConfirmDelete(false); setTitleMenuOpen(false) }
    else setConfirmDelete(true)
  }, [activeId, confirmDelete, deleteSession])

  /* ── Send message ── */
  const handleSend = useCallback(async (
    text: string,
    files?: ChatMessage['files'],
    priorMessagesOverride?: ChatMessage[],
    options: { webSearch: boolean; skills: InstalledSkill[] } = { webSearch: false, skills: [] },
  ) => {
    if (!text.trim() && (!files || files.length === 0)) return

    let sessionId = activeId
    if (!sessionId) { const s = createSession(); sessionId = s.id }

    setModelUnavailable(null); setIsSearching(false); setSearchDone(false)
    setSearchQuery(''); setActiveSkillNames(options.skills.map(skill => skill.name)); setHaluWarningMsgId(null)

    const priorMessages = priorMessagesOverride || activeSessionRef.current?.messages || []
    const apiMessages = buildApiMessages([
      ...priorMessages,
      { role: 'user', content: text, files: files as ChatMessage['files'] },
    ])

    addMessage(sessionId, { role: 'user', content: text, files })
    const aiMsg = addMessage(sessionId, { role: 'assistant', content: '' })

    setIsGenerating(true)

    const controller = new AbortController()
    abortRef.current = controller

    let accumulated = ''

    try {
      await streamChatCompletion({
        messages:    apiMessages,
        model:       selectedModelId,
        maxTokens:   2048,
        temperature: 0.2,
        sessionId:   sessionId,
        customProviders,
        webSearch:   options.webSearch,
        skills:      options.skills,
        memory:      settings.memoryEnabled ? settings.memory : '',
        signal:      controller.signal,
        onToken: (chunk) => {
          accumulated += chunk
          updateMessage(sessionId!, aiMsg.id, accumulated)
        },
        onModelUsed: (_model, _provider) => { /* could show in UI if needed */ },
        onSearchStart: (q) => {
          setSearchQuery(q); setIsSearching(true); setSearchDone(false)
        },
        onSearchDone:  (_n) => {
          setIsSearching(false); setSearchDone(true)
        },
        onSources: (sources: SourceItem[]) => {
          updateMessage(sessionId!, aiMsg.id, null, { sources })
        },
        onModelUnavailable: (msg) => setModelUnavailable(msg),
      })

      if (accumulated === '' && !controller.signal.aborted) {
        updateMessage(sessionId!, aiMsg.id, null, { failed: true })
      }

      if (accumulated && detectHallucinationWarning(accumulated)) {
        setHaluWarningMsgId(aiMsg.id)
      }

      // Auto-generate better title
      const session = sessionsRef.current.find(s => s.id === sessionId)
      if (session && session.title === 'New Chat') {
        const summary = `${text}\n\nAssistant: ${accumulated}`
        generateTitle(summary, sessionId!).then(aiTitle => { if (aiTitle) renameSession(sessionId!, aiTitle) })
      }

      // Auto-update memory in the background (fire-and-forget)
      if (accumulated && text.trim()) {
        void updateMemory(text, accumulated)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const raw = (err as Error).message || ''
        const friendly = raw.includes('fetch') || raw.includes('network') || raw.includes('500')
          ? "Couldn't reach the model. Try again or switch to a different model."
          : raw.length > 0 && raw.length < 120 && !raw.includes('://') && !raw.includes('{')
            ? raw : 'Something went wrong. Please try again.'
        setModelUnavailable(friendly)
        if (accumulated === '') updateMessage(sessionId!, aiMsg.id, null, { failed: true })
      }
    } finally {
      setIsGenerating(false); setIsSearching(false); setSearchDone(false); setActiveSkillNames([])
      abortRef.current = null
    }
  }, [activeId, createSession, addMessage, updateMessage, setIsGenerating, abortRef, selectedModelId, customProviders, renameSession, generateTitle, updateMemory, settings.memory, settings.memoryEnabled])

  const handleEditMessage = useCallback((message: ChatMessage, content: string) => {
    if (!activeId) return
    const currentMessages = activeSessionRef.current?.messages || []
    const messageIndex = currentMessages.findIndex(item => item.id === message.id)
    if (messageIndex < 0) return
    const priorMessages = currentMessages.slice(0, messageIndex)
    trimMessagesFrom(activeId, message.id)
    void handleSend(content, message.files, priorMessages)
  }, [activeId, handleSend, trimMessagesFrom])

  /* ── Stop ── */
  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsGenerating(false); setIsSearching(false); setSearchDone(false); setActiveSkillNames([])
  }, [abortRef, setIsGenerating])

  /* ── Apply theme ── */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark')
  }, [settings.theme])

  /* ── Welcome modal ────────────────────────────────
     - Muncul tiap kunjungan jika user belum centang "Don't show again"
     - Jika sudah centang (hasSeenWelcome: true), tidak muncul lagi
     - Guard showWelcome mencegah modal muncul ulang dalam sesi yang sama
       setelah ditutup tanpa centang
  ── */
  useEffect(() => {
    if (hydrated && !settings.hasSeenWelcome && !showWelcome) {
      setShowWelcome(true)
    }
    // showWelcome sengaja tidak masuk deps — hanya ingin effect ini
    // re-run saat hydration selesai atau status hasSeenWelcome berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, settings.hasSeenWelcome])

  if (!hydrated) return null // avoid hydration mismatch

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        collapsed={!sidebarOpen}
        onNewChat={handleNewChat}
        onSwitch={handleSwitch}
        onDelete={deleteSession}
        onRename={renameSession}
        onPin={togglePinSession}
        onShare={session => { void handleShareSession(session) }}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main */}
      <div
        className={cn(
          'preview-layout relative flex min-w-0 flex-1 flex-col',
          !previewDragging && 'transition-[margin] duration-300 ease-out'
        )}
        style={{ '--preview-width': `${previewOpen ? previewWidth : artifactsOpen ? 360 : 0}px` } as React.CSSProperties}
      >
        {/* Model unavailable warning */}
        {modelUnavailable && (
          <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span className="flex-1">{modelUnavailable.replace(/\*\*/g, '')}</span>
            <button onClick={() => setModelUnavailable(null)} className="rounded-md px-1.5 py-0.5 text-xs hover:bg-amber-200/50 transition-colors" aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Chat area */}
        <ChatArea
          messages={messages}
          isGenerating={isGenerating}
          isSearching={isSearching}
          searchDone={searchDone}
          searchQuery={searchQuery}
          activeSkillNames={activeSkillNames}
          haluWarningMsgId={haluWarningMsgId}
          onSuggestionClick={handleSend}
          onRegenerate={(msg) => handleSend(msg.content)}
          onRetryAssistant={msg => {
            const messageIndex = messages.findIndex(item => item.id === msg.id)
            const previousUser = messageIndex > 0
              ? [...messages.slice(0, messageIndex)].reverse().find(item => item.role === 'user')
              : undefined
            if (previousUser) void handleSend(previousUser.content)
          }}
          onEdit={handleEditMessage}
          onLike={() => {}}
          onDislike={() => {}}
          onShare={() => {}}
          hasExperimentalModel={selectedModel?.experimental === true}
          toolbar={
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-background px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  onClick={() => setSidebarOpen(o => !o)}
                  className="pointer-events-auto shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                >
                  <Menu size={17} />
                </button>
                <div ref={titleMenuRef} className="pointer-events-auto relative">
                  {editingTitle ? (
                    <input
                      ref={titleInputRef}
                      value={titleValue}
                      onChange={event => setTitleValue(event.target.value)}
                      onKeyDown={handleTitleKeyDown}
                      onBlur={commitHeaderRename}
                      className="w-[min(52vw,28rem)] rounded-md bg-muted px-2 py-1 text-sm font-medium text-foreground outline-none ring-1 ring-ring"
                      aria-label="Rename conversation"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTitleMenuOpen(open => !open)}
                      onDoubleClick={startHeaderRename}
                      className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
                      title="Conversation actions; double-click to rename"
                    >
                      <span className="max-w-[min(52vw,28rem)] truncate text-sm font-medium text-foreground">
                        {activeSession?.title || 'New Chat'}
                      </span>
                      <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                    </button>
                  )}
                  {titleMenuOpen && !editingTitle && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-border bg-popover py-1 shadow-lg">
                      <button onClick={() => { if (activeId) togglePinSession(activeId); setTitleMenuOpen(false) }} disabled={!activeSession} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-40">
                        <Pin size={14} className="text-muted-foreground" />
                        {activeSession?.pinned ? 'Unpin chat' : 'Pin chat'}
                      </button>
                      <button onClick={startHeaderRename} disabled={!activeSession} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-40">
                        <Edit3 size={14} className="text-muted-foreground" />
                        Rename
                      </button>
                      <button onClick={handleShareChat} disabled={!activeSession} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-40">
                        <Share2 size={14} className="text-muted-foreground" />
                        Share chat
                      </button>
                      <div className="my-1 border-t border-border" />
                      <button onClick={handleDeleteActive} disabled={!activeSession} className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors disabled:opacity-40', confirmDelete ? 'bg-destructive/10 text-destructive' : 'hover:bg-muted')}>
                        <Trash2 size={14} className={confirmDelete ? 'text-destructive' : 'text-muted-foreground'} />
                        {confirmDelete ? 'Click again to confirm' : 'Delete chat'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="pointer-events-auto flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={handleShareChat}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Share chat"
                  >
                    <Share2 size={17} />
                  </button>
                )}
                {hasGeneratedDocument && (
                  <button
                    onClick={() => { setArtifactsOpen(open => !open); setShareOpen(false) }}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Open document preview"
                  >
                    <FileText size={17} />
                  </button>
                )}
                {shareOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-border bg-popover p-3 shadow-xl">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Share chat</p>
                        <p className="mt-1 text-xs text-muted-foreground">Only messages up until now will be shared</p>
                      </div>
                      <button onClick={() => setShareOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close share menu">×</button>
                    </div>
                    <button onClick={copyChatLink} className="mt-3 flex w-full items-center justify-center rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground hover:bg-secondary/80">
                      {linkCopied ? 'Link copied' : 'Copy link'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          }
        />

        {/* Composer */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent pt-8">
          <div className="pointer-events-auto">
            <Composer
              onSend={(text, files, options) => handleSend(text, files, undefined, options)}
              onStop={handleStop}
              isGenerating={isGenerating}
              enterToSend={settings.enterToSend}
              selectedModel={selectedModelId}
              onSelectModel={(id) => updateSettings({ selectedModel: id })}
              models={availableModels}
              customProviders={customProviders}
              onCustomProvidersChange={setCustomProviders}
              memoryEnabled={settings.memoryEnabled}
              onToggleMemory={enabled => updateSettings({ memoryEnabled: enabled })}
            />
          </div>
        </div>

        {artifactsOpen && !previewOpen && (
          <aside className="fixed right-0 top-0 z-40 flex h-full w-[360px] max-w-[calc(100vw-2rem)] flex-col border-l border-border bg-background shadow-2xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <p className="text-sm font-semibold text-foreground">Artifacts</p>
              <button onClick={() => setArtifactsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close artifacts">×</button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {generatedDocuments.map(({ message, config }) => (
                <button
                  key={message.id}
                  onClick={() => {
                    setArtifactsOpen(false)
                    window.dispatchEvent(new CustomEvent('nyx-open-latest-preview', { detail: message.id }))
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{config.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">Document · {config.type.toUpperCase()}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* Settings panel */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onUpdate={updateSettings}
          onClearAll={clearAll}
        />
      )}

      {/* Welcome modal — ditampilkan sekali saat pertama kali masuk */}
      {showWelcome && (
        <WelcomeModal
          onClose={(dontShowAgain) => {
            setShowWelcome(false)
            if (dontShowAgain) updateSettings({ hasSeenWelcome: true })
          }}
        />
      )}
    </div>
  )
}
