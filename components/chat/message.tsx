'use client'

/* ═══════════════════════════════════════════════════
   Message — Single chat message bubble
   Ported from ChatArea.jsx Message sub-component
═══════════════════════════════════════════════════ */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Copy, RefreshCw, Check, ThumbsUp, ThumbsDown, Share2, FileDown, X, PanelRightClose, PanelRightOpen, GripVertical, Pencil, ChevronDown } from 'lucide-react'
import { MarkdownRenderer } from './markdown-renderer'
import { SourcesPanel }     from './sources-panel'
import { parseSources }     from '@/lib/parse-sources'
import { getFileIcon, formatFileSize } from '@/lib/file-utils'
import type { ChatMessage, ChatFile } from '@/lib/storage'
import { cn } from '@/lib/utils'
import {
  parseExportConfig,
  stripExportConfig,
  extractExportContent,
  useExportFile,
  type ExportConfig,
  type ExportFont,
  type ExportTemplate,
} from '@/hooks/use-export-file'

interface MessageProps {
  message:         ChatMessage
  isGenerating:    boolean
  isSearching?:    boolean
  activeSkillNames?: string[]
  isLastUser:      boolean
  isStreaming:     boolean
  showHaluWarning: boolean
  onRegenerate?:   (msg: ChatMessage) => void
  onRetryAssistant?: (msg: ChatMessage) => void
  onEdit?:         (msg: ChatMessage, content: string) => void
  onCopyMessage?:  (msg: ChatMessage) => void
  onLike?:         (msg: ChatMessage, val: 'like' | null) => void
  onDislike?:      (msg: ChatMessage, val: 'dislike' | null) => void
  onShare?:        (msg: ChatMessage, ok: boolean) => void
}

export function Message({
  message, isGenerating, isSearching = false, activeSkillNames = [], isLastUser, isStreaming = false,
  showHaluWarning = false,
  onRegenerate, onRetryAssistant, onCopyMessage, onLike, onDislike, onShare,
  onEdit,
}: MessageProps) {
  const [copied, setCopied]             = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [thinkingSeconds, setThinkingSeconds] = useState(0)
  const [feedback, setFeedback]         = useState<'like' | 'dislike' | null>(null)
  const [previewOpen, setPreviewOpen]   = useState(false)
  const [previewWidth, setPreviewWidth] = useState(640)
  const [editing, setEditing]         = useState(false)
  const [editValue, setEditValue]     = useState(message.content)
  const [shareOpen, setShareOpen]     = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<ExportTemplate>('auto')
  const [selectedFont, setSelectedFont] = useState<ExportFont>('auto')
  const thinkingTimerRef                = useRef<ReturnType<typeof setInterval> | null>(null)

  const isUser  = message.role === 'user'
  const isAI    = message.role === 'assistant'
  const hasContent = (message.content || '').length > 0
  const hasFiles   = message.files && message.files.length > 0

  // Export config — only parse once streaming is done to avoid flicker
  const exportConfig = useMemo<ExportConfig | null>(() => {
    if (!isAI || isStreaming) return null
    return parseExportConfig(message.content || '')
  }, [isAI, isStreaming, message.content])

  useEffect(() => {
    if (exportConfig) {
      setSelectedTemplate(exportConfig.template)
      setSelectedFont(exportConfig.font)
    }
  }, [exportConfig])

  const activeExportConfig = exportConfig ? { ...exportConfig, template: selectedTemplate, font: selectedFont } : null

  // Rendered content strips the export-config fence so it doesn't show as a code block
  const renderedContent = useMemo(() => {
    if (!isAI) return message.content || ''
    return exportConfig ? stripExportConfig(message.content || '') : (message.content || '')
  }, [isAI, exportConfig, message.content])

  const {
    exportFile, fetchBlob, fetchPreviewHtml,
    loading: exportLoading, error: exportError, done: exportDone,
  } = useExportFile()

  // For PDF: blob URL in iframe. For DOCX/XLSX: HTML string in srcDoc iframe.
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null)
  const [previewHtml, setPreviewHtml]   = useState<string | null>(null)

  // Revoke any lingering blob URL when the component unmounts
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExport = useCallback(() => {
    if (!exportConfig) return
    const content = extractExportContent(message.content || '')
    exportFile(activeExportConfig!, content)
  }, [activeExportConfig, message.content, exportFile])

  const openPreview = useCallback(async () => {
    if (!activeExportConfig) return
    try {
      const content = extractExportContent(message.content || '')
      if (activeExportConfig.type === 'pdf') {
        const blob = await fetchBlob(activeExportConfig, content)
        setPreviewUrl(prev => {
          if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
          return URL.createObjectURL(blob)
        })
        setPreviewHtml(null)
      } else {
        const html = await fetchPreviewHtml(activeExportConfig, content)
        setPreviewHtml(html)
        setPreviewUrl(null)
      }
      setPreviewOpen(true)
      window.dispatchEvent(new CustomEvent('nyx-close-other-previews', { detail: message.id }))
      window.dispatchEvent(new CustomEvent('nyx-preview-change', { detail: { open: true, width: previewWidth } }))
    } catch {
      // silent — user can still use Download
    }
  }, [activeExportConfig, fetchBlob, fetchPreviewHtml, message.content, message.id, previewWidth])

  const closePreview = useCallback(() => {
    setPreviewOpen(false)
    setPreviewHtml(null)
    setPreviewUrl(prev => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
      return null
    })
    window.dispatchEvent(new CustomEvent('nyx-preview-change', { detail: { open: false, width: 0 } }))
  }, [])

  useEffect(() => {
    const handleCloseOtherPreviews = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (detail && detail !== message.id && previewOpen) {
        closePreview()
      }
    }

    window.addEventListener('nyx-close-other-previews', handleCloseOtherPreviews)
    return () => window.removeEventListener('nyx-close-other-previews', handleCloseOtherPreviews)
  }, [closePreview, message.id, previewOpen])

  useEffect(() => {
    if (!exportConfig || isStreaming) return
    const handleLatestPreview = (event: Event) => {
      if ((event as CustomEvent<string>).detail === message.id) openPreview()
    }
    window.addEventListener('nyx-open-latest-preview', handleLatestPreview)
    return () => window.removeEventListener('nyx-open-latest-preview', handleLatestPreview)
  }, [exportConfig, isStreaming, message.id, openPreview])

  const sources = useMemo(() => {
    if (message.sources && message.sources.length > 0) return message.sources
    if (!isAI || isStreaming || !hasContent) return []
    return parseSources(message.content || '').sources
  }, [isAI, isStreaming, hasContent, message.sources, message.content])

  // Thinking overlay
  const skillStatusText = activeSkillNames.length > 0
    ? (activeSkillNames.length === 1 ? `Using ${activeSkillNames[0]}` : 'Using skills')
    : null
  const statusText = isSearching
    ? 'Searching the web'
    : (skillStatusText || (thinkingSeconds < 3 ? 'Thinking' : 'Processing'))
  const shouldShowThinking = (isStreaming || isSearching || activeSkillNames.length > 0) && !hasContent

  useEffect(() => {
    if (shouldShowThinking) {
      setShowThinking(true)
      setThinkingSeconds(0)
      thinkingTimerRef.current = setInterval(() => setThinkingSeconds(s => s + 1), 1000)
    } else {
      setShowThinking(false)
      setThinkingSeconds(0)
      if (thinkingTimerRef.current) { clearInterval(thinkingTimerRef.current); thinkingTimerRef.current = null }
    }
    return () => { if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current) }
  }, [shouldShowThinking])

  useEffect(() => {
    if (hasContent && showThinking) {
      const t = setTimeout(() => setShowThinking(false), 300)
      return () => clearTimeout(t)
    }
  }, [hasContent, showThinking])

  const handleCopy = useCallback(() => {
    if (!message.content) return
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = message.content; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
    onCopyMessage?.(message)
  }, [message, onCopyMessage])

  const handleLike = useCallback(() => {
    const next = feedback === 'like' ? null : 'like' as const
    setFeedback(next); onLike?.(message, next)
  }, [feedback, message, onLike])

  const handleDislike = useCallback(() => {
    const next = feedback === 'dislike' ? null : 'dislike' as const
    setFeedback(next); onDislike?.(message, next)
  }, [feedback, message, onDislike])

  const submitEdit = useCallback(() => {
    const next = editValue.trim()
    if (next && next !== message.content) onEdit?.(message, next)
    setEditing(false)
  }, [editValue, message, onEdit])

  const copyResponseLink = useCallback(async () => {
    await navigator.clipboard?.writeText(window.location.href)
    onShare?.(message, true)
    setShareOpen(false)
  }, [message, onShare])

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-full flex-col space-y-1', isUser ? 'max-w-[85%] items-end' : 'items-start')}>

        {/* File attachments (user) */}
        {isUser && hasFiles && <FileAttachments files={message.files!} />}

        {/* Thinking overlay */}
        {showThinking && (
          <div className="-mt-0.5 flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground transition-opacity duration-200 ease-out">
            <span className="font-medium text-foreground/80">{statusText}</span>
            <span className="flex items-center gap-1">
              {[0,1,2].map(i => (
                <span
                  key={i}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/60 animate-pulse"
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1.2s' }}
                />
              ))}
            </span>
            {thinkingSeconds > 0 && !isSearching && !skillStatusText && <span className="text-[11px] text-muted-foreground">{thinkingSeconds}s</span>}
          </div>
        )}

        {/* Message bubble */}
        {(message.content || !hasFiles) && (
          <div
            className={cn(
              'w-fit max-w-full rounded-2xl px-4 py-2.5 text-sm',
              isUser && !editing
                ? 'bg-primary text-primary-foreground rounded-br-sm'
                : isAI
                  ? 'text-foreground rounded-bl-sm'
                  : 'bg-transparent p-0'
            )}
          >
            {isAI ? (
              message.failed ? (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Couldn't get a response. Try sending again or switch to a different model.
                </div>
              ) : (
                <div className={isStreaming && hasContent ? 'streaming' : ''}>
                  <MarkdownRenderer content={renderedContent} isStreaming={isStreaming && hasContent} sources={sources} />
                  {!isStreaming && sources.length > 0 && <SourcesPanel sources={sources} />}
                </div>
              )
            ) : editing ? (
              <div className="w-[min(70vw,36rem)] max-w-full rounded-xl border border-border bg-background p-2 text-foreground shadow-sm">
                <textarea
                  autoFocus
                  value={editValue}
                  onChange={event => setEditValue(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') setEditing(false)
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitEdit() }
                  }}
                  className="scrollbar-hidden min-h-24 w-full resize-y rounded-lg bg-transparent px-2.5 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                />
                <div className="mt-1 flex items-center justify-end gap-2 border-t border-border px-1 pt-2">
                  <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
                  <button type="button" onClick={submitEdit} className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-80">Send</button>
                </div>
              </div>
            ) : (
              <span className="whitespace-pre-wrap">{message.content}</span>
            )}
          </div>
        )}

        {/* File attachments (AI) */}
        {isAI && hasFiles && <FileAttachments files={message.files!} />}

        {/* Generated document download card */}
        {isAI && exportConfig && !isStreaming && (
          <div className="w-full max-w-xl rounded-2xl border border-border bg-muted/40 p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-primary shadow-sm ring-1 ring-border/60">
                <FileDown size={18} strokeWidth={1.8} />
              </div>

              <button
                type="button"
                onClick={openPreview}
                className="min-w-0 flex-1 text-left"
                title="Preview document"
              >
                <p className="truncate text-[13px] font-semibold leading-5 text-foreground" title={exportConfig.title}>
                  {exportConfig.title}
                </p>
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {exportConfig.type} document
                </p>
              </button>

              <button
                type="button"
                onClick={handleExport}
                disabled={exportLoading}
                className="h-9 shrink-0 rounded-lg bg-foreground px-3.5 text-xs font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-60"
              >
                {exportLoading ? 'Generating…' : exportDone ? 'Downloaded' : exportError ? 'Retry' : 'Download'}
              </button>
            </div>

            {exportConfig.type === 'pdf' && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <DocumentSelect
                  value={selectedTemplate}
                  onChange={value => setSelectedTemplate(value as ExportTemplate)}
                  label="Template"
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'academic', label: 'Academic' },
                    { value: 'formal', label: 'Formal' },
                    { value: 'informal', label: 'Informal' },
                  ]}
                  className="w-full"
                />
                <DocumentSelect
                  value={selectedFont}
                  onChange={value => setSelectedFont(value as ExportFont)}
                  label="Font"
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'Inter', label: 'Inter' },
                    { value: 'Lora', label: 'Lora' },
                    { value: 'Playfair Display', label: 'Playfair' },
                    { value: 'Merriweather', label: 'Merriweather' },
                    { value: 'Roboto', label: 'Roboto' },
                    { value: 'Open Sans', label: 'Open Sans' },
                    { value: 'Montserrat', label: 'Montserrat' },
                    { value: 'Source Sans 3', label: 'Source Sans 3' },
                  ]}
                  className="w-full"
                />
              </div>
            )}
          </div>
        )}

        {previewOpen && exportConfig && (
          <DocumentPreview
            config={activeExportConfig!}
            previewUrl={previewUrl}
            previewHtml={previewHtml}
            width={previewWidth}
            onWidthChange={setPreviewWidth}
            onClose={closePreview}
            onDownload={handleExport}
            isDownloading={exportLoading}
          />
        )}

        {/* Hallucination warning */}
        {isAI && showHaluWarning && hasContent && !isStreaming && (
          <p className="px-3 text-xs text-amber-500" role="status">
            ⚠ This answer may be inaccurate the AI used internal knowledge, not up-to-date data.
          </p>
        )}

        {/* AI message actions */}
        {isAI && hasContent && !isStreaming && (
          <div className="flex items-center gap-1 px-1 pt-1">
            <ActionBtn label="Retry" onClick={() => onRetryAssistant?.(message)} disabled={!onRetryAssistant}>
              <RefreshCw size={13} />
            </ActionBtn>
            <ActionBtn label="Good Response" onClick={handleLike} active={feedback === 'like'}>
              <ThumbsUp size={13} />
            </ActionBtn>
            <ActionBtn label="Bad Response" onClick={handleDislike} active={feedback === 'dislike'}>
              <ThumbsDown size={13} />
            </ActionBtn>
            <ActionBtn label={copied ? 'Copied!' : 'Copy'} onClick={handleCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </ActionBtn>
            <ActionBtn label="Share" onClick={() => setShareOpen(open => !open)}>
              <Share2 size={13} />
            </ActionBtn>
            {shareOpen && (
              <div className="relative">
                <div className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-xl border border-border bg-popover p-3 shadow-xl">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Share response</p>
                      <p className="mt-1 text-xs text-muted-foreground">Share this response with a link.</p>
                    </div>
                    <button onClick={() => setShareOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close share response">×</button>
                  </div>
                  <button onClick={copyResponseLink} className="mt-3 w-full rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground hover:bg-secondary/80">Copy link</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Export error */}
        {exportError && !isStreaming && (
          <p className="px-3 text-xs text-destructive" role="alert">⚠ {exportError}</p>
        )}

        {/* User message actions */}
        {isUser && (hasContent || (isLastUser && onRegenerate)) && (
          <div className="flex items-center justify-end gap-1 px-1 pt-1">
            {isLastUser && onRegenerate && (
              <ActionBtn label="Retry" onClick={() => onRegenerate(message)}>
                <RefreshCw size={13} />
              </ActionBtn>
            )}
            {hasContent && onEdit && (
              <ActionBtn label="Edit" onClick={() => { setEditValue(message.content); setEditing(true) }}>
                <Pencil size={13} />
              </ActionBtn>
            )}
            {hasContent && (
              <ActionBtn label={copied ? 'Copied!' : 'Copy'} onClick={handleCopy}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </ActionBtn>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DocumentSelect({
  value, onChange, label, options, className = '',
}: {
  value: string
  onChange: (value: string) => void
  label: string
  options: Array<{ value: string; label: string }>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'up' | 'down'>('up')
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = options.find(option => option.value === value) || options[0]

  const toggleOpen = () => {
    if (!open && containerRef.current) {
      const { top, bottom } = containerRef.current.getBoundingClientRect()
      const estimatedHeight = Math.min(options.length * 36 + 8, 256)
      const safeTop = 96
      setPlacement(top - estimatedHeight >= safeTop ? 'up' : 'down')
    }
    setOpen(current => !current)
  }

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={cn('relative min-w-0 flex-1', className)}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected.label}`}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border bg-background px-2.5 text-left text-xs font-medium text-foreground outline-none transition-colors',
          open ? 'border-foreground/50 ring-2 ring-ring/20' : 'border-border hover:border-foreground/30'
        )}
      >
        <span className="truncate"><span className="text-muted-foreground">{label}:</span> {selected.label}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div
        role="listbox"
        aria-label={label}
        className={cn(
          'document-select-scrollbar absolute right-0 z-50 max-h-64 min-w-full overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-black/5',
          placement === 'up' ? 'bottom-[calc(100%+0.4rem)]' : 'top-[calc(100%+0.4rem)]'
        )}
      >
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            onClick={() => { onChange(option.value); setOpen(false) }}
            className={cn(
              'flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted',
              option.value === value ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>}
    </div>
  )
}

function DocumentPreview({
  config, previewUrl, previewHtml, width, onWidthChange, onClose, onDownload, isDownloading,
}: {
  config: ExportConfig
  previewUrl: string | null
  previewHtml: string | null
  width: number
  onWidthChange: (width: number) => void
  onClose: () => void
  onDownload: () => void
  isDownloading: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const dragStartRef = useRef<{ x: number; width: number } | null>(null)

  const reportLayout = useCallback((nextWidth: number, isOpen = true, dragging = false) => {
    window.dispatchEvent(new CustomEvent('nyx-preview-change', {
      detail: { open: isOpen, width: nextWidth, dragging },
    }))
  }, [])

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = { x: event.clientX, width }
    reportLayout(width, true, true)
  }, [collapsed, reportLayout, width])

  const handleResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    const nextWidth = Math.min(Math.max(dragStartRef.current.width + dragStartRef.current.x - event.clientX, 360), Math.min(window.innerWidth * 0.72, 960))
    onWidthChange(nextWidth)
    reportLayout(nextWidth, true, true)
  }, [onWidthChange, reportLayout])

  const handleResizeEnd = useCallback(() => {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    reportLayout(width, true, false)
  }, [reportLayout, width])

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed
    setCollapsed(next)
    reportLayout(next ? 56 : width)
  }, [collapsed, reportLayout, width])

  const renderBody = () => {
    // PDF — blob URL in iframe
    if (previewUrl) {
      return (
        <iframe
          title={`Preview ${config.title}`}
          src={previewUrl}
          className="block h-full min-h-[32rem] w-full border-0 bg-white shadow-sm overscroll-contain"
        />
      )
    }
    // DOCX / XLSX — server-rendered HTML with A4 page simulation in srcDoc iframe
    if (previewHtml) {
      return (
        <iframe
          title={`Preview ${config.title}`}
          srcDoc={previewHtml}
          sandbox="allow-scripts"
          className="block h-full min-h-[32rem] w-full border-0 bg-[#e8eaed] overscroll-contain"
        />
      )
    }
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-slate-600">
        <p className="font-medium text-slate-800">Memuat preview…</p>
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex justify-end overscroll-none" role="dialog" aria-modal="false" aria-label={`Preview ${config.title}`}>
      <aside
        style={{ '--preview-width': `${collapsed ? 56 : width}px` } as React.CSSProperties}
        className="pointer-events-auto relative ml-auto flex h-full w-full max-w-none flex-col border-l border-border bg-background shadow-2xl md:w-[var(--preview-width)]"
      >
        {/* Resize handle */}
        <div
          className="absolute -left-2 top-0 z-10 hidden h-full w-4 cursor-col-resize items-center justify-center md:flex"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResize}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          title="Drag to resize preview"
        >
          <GripVertical size={14} className="text-muted-foreground/60" />
        </div>

        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{config.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {config.type.toUpperCase()} · {config.template} · {config.font}
              </p>
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={onDownload}
              disabled={isDownloading}
              className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-60"
            >
              {isDownloading ? 'Generating…' : 'Download'}
            </button>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={collapsed ? 'Expand preview' : 'Collapse preview'}
          >
            {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close preview"
          >
            <X size={19} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {renderBody()}
        </div>
      </aside>
    </div>
  )
}

// ── File attachments ──────────────────────────────
function FileAttachments({ files }: { files: ChatFile[] }) {
  if (!files.length) return null
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-2">
      {files.map(file => (
        <div key={file.id} className="flex min-w-0 max-w-[min(100%,22rem)] items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
          {file.type === 'image' && file.dataUrl ? (
            <img
              src={file.dataUrl} alt={file.name}
              className="h-12 w-12 cursor-pointer rounded object-cover"
              onClick={() => window.open(file.dataUrl, '_blank')}
            />
          ) : (
            <>
              <span className="shrink-0">{getFileIcon(file.type)}</span>
              <div className="min-w-0 max-w-full">
                <p className="truncate font-medium text-foreground" title={file.name}>{file.name}</p>
                <p className="text-muted-foreground">{formatFileSize(file.size)}</p>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Action button ─────────────────────────────────
function ActionBtn({
  label, onClick, disabled, active, children,
}: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'flex items-center gap-1 rounded-md p-1.5 text-xs transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      {children}
    </button>
  )
}
