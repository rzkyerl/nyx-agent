'use client'

/* ═══════════════════════════════════════════════════
   Composer — Textarea + file upload + model selector + send
   Ported from Composer.jsx (Vite project)
═══════════════════════════════════════════════════ */

import { useRef, useEffect, useCallback, useState } from 'react'
import { Paperclip, ArrowUp, Square, X, ChevronDown, Check, FileText, Image as ImageIcon } from 'lucide-react'
import { FILE_CONFIG, getFileIcon, formatFileSize, processFile } from '@/lib/file-utils'
import type { ChatFile } from '@/lib/storage'
import type { NyxModel } from '@/lib/models'
import { cn } from '@/lib/utils'
import { BorderBeam } from '@/components/ui/border-beam'

const FILE_CATEGORIES = [
  { id: 'photos',    label: 'Photos & Images', icon: ImageIcon, accept: 'image/*' },
  { id: 'documents', label: 'Documents (PDF, DOCX, TXT, Code)', icon: FileText, accept: '.pdf,.docx,.doc,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.rb,.php,.sql,.yaml,.yml,.sh' },
  { id: 'any',       label: 'Any file', icon: Paperclip, accept: FILE_CONFIG.accept },
]

interface ComposerProps {
  onSend:          (text: string, files?: ChatFile[]) => void
  onStop:          () => void
  isGenerating:    boolean
  enterToSend?:    boolean
  selectedModel?:  string
  onSelectModel?:  (id: string) => void
  models?:         NyxModel[]
}

export function Composer({
  onSend, onStop, isGenerating,
  enterToSend = true, selectedModel = 'auto',
  onSelectModel, models = [],
}: ComposerProps) {
  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const modelMenuRef   = useRef<HTMLDivElement>(null)
  const filMenuRef     = useRef<HTMLDivElement>(null)

  const [value, setValue]               = useState('')
  const [files, setFiles]               = useState<ChatFile[]>([])
  const [isDragging, setIsDragging]     = useState(false)
  const [fileError, setFileError]       = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [fileMenuOpen, setFileMenuOpen]   = useState(false)
  const [fileAccept, setFileAccept]       = useState(FILE_CONFIG.accept)
  const [composerFocused, setComposerFocused] = useState(false)

  const selectedModelObj = models.find(m => m.id === selectedModel) || models[0]

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = Math.max(120, Math.floor(window.innerHeight * 0.35))
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px'
  }, [])

  useEffect(() => { autoResize() }, [value, autoResize])
  useEffect(() => {
    window.addEventListener('resize', autoResize)
    return () => window.removeEventListener('resize', autoResize)
  }, [autoResize])

  // Close menus on outside click
  useEffect(() => {
    if (!modelMenuOpen && !fileMenuOpen) return
    const h = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setModelMenuOpen(false)
      if (filMenuRef.current  && !filMenuRef.current.contains(e.target as Node))   setFileMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [modelMenuOpen, fileMenuOpen])

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setModelMenuOpen(false); setFileMenuOpen(false) } }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  // File picker
  const openFilePicker = useCallback((accept: string) => {
    setFileAccept(accept); setFileMenuOpen(false)
    requestAnimationFrame(() => {
      if (fileInputRef.current) { fileInputRef.current.accept = accept; fileInputRef.current.click() }
    })
  }, [])

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    setFileError(null)
    const incoming = Array.from(fileList)
    if (files.length + incoming.length > FILE_CONFIG.maxFiles) {
      setFileError(`Maximum ${FILE_CONFIG.maxFiles} files allowed`); return
    }
    const valid = incoming.filter(f => {
      if (f.size > FILE_CONFIG.maxSizeBytes) { setFileError(`"${f.name}" exceeds ${formatFileSize(FILE_CONFIG.maxSizeBytes)}`); return false }
      return true
    })
    if (!valid.length) return
    setIsExtracting(true)
    try {
      const processed = await Promise.all(valid.map(f => processFile(f).catch(() => null)))
      const ok = processed.filter((f): f is ChatFile => f !== null)
      if (ok.length) setFiles(prev => [...prev, ...ok])
    } finally { setIsExtracting(false) }
  }, [files.length])

  const removeFile   = useCallback((id: string) => setFiles(prev => prev.filter(f => f.id !== id)), [])
  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''
  }, [addFiles])

  const handleDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); if (e.currentTarget === e.target) setIsDragging(false) }, [])
  const handleDrop      = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files) }, [addFiles])
  const handlePaste     = useCallback((e: React.ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData?.items || []).filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => f !== null)
    if (pasted.length) { e.preventDefault(); addFiles(pasted) }
  }, [addFiles])

  const canSend = (value.trim().length > 0 || files.length > 0) && !isGenerating && !isExtracting
  const handleSend = useCallback(() => {
    if (!canSend) return
    onSend(value.trim(), files.length > 0 ? files : undefined)
    setValue(''); setFiles([]); setFileError(null)
    requestAnimationFrame(() => { if (textareaRef.current) textareaRef.current.style.height = 'auto' })
  }, [canSend, value, files, onSend])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) { e.preventDefault(); handleSend() }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey))   { e.preventDefault(); handleSend() }
  }

  return (
    <div
      className={cn(
        'relative mx-auto w-full max-w-3xl px-4 pb-4',
        isDragging && 'ring-2 ring-primary ring-offset-2 rounded-2xl'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/10">
          <p className="text-sm font-medium text-primary">Drop files here</p>
        </div>
      )}

      <BorderBeam
        active={composerFocused || isDragging}
        size="md"
        colorVariant="mono"
        theme="auto"
        duration={2.4}
        strength={0.8}
        borderRadius={16}
        className="rounded-2xl"
        style={{ overflow: 'visible' }}
      >
      <div
        className="composer-shell rounded-2xl border border-border bg-background shadow-sm"
        onFocusCapture={() => setComposerFocused(true)}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerFocused(false)
        }}
      >
        {/* File chips */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border px-3 pt-3 pb-2">
            {files.map(file => (
              <div key={file.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1 text-xs">
                <span>{getFileIcon(file.type)}</span>
                <span className="max-w-[120px] truncate font-medium">{file.name}</span>
                <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
                <button onClick={() => removeFile(file.id)} className="rounded p-0.5 hover:bg-muted-foreground/20 transition-colors" title="Remove">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {isExtracting && <p className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">Extracting file content…</p>}
        {fileError    && <p className="px-3 py-1.5 text-xs text-destructive border-b border-border">{fileError}</p>}

        {/* Experimental model warning */}
        {selectedModelObj?.experimental && (
          <div className="border-b border-border bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <strong>{selectedModelObj.label}</strong> is early access and may be temporarily unavailable.
          </div>
        )}

        <input ref={fileInputRef} type="file" accept={fileAccept} multiple style={{ display: 'none' }} onChange={handleFilePick} />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          placeholder="Build anything…"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
        />

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center gap-1">
            {/* File attach */}
            <div ref={filMenuRef} className="relative">
              <button
                onClick={() => setFileMenuOpen(o => !o)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Attach file"
              >
                <Paperclip size={14} />
              </button>
              {fileMenuOpen && (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-[280px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-1.5 shadow-lg">
                  {FILE_CATEGORIES.map(cat => {
                    const Icon = cat.icon
                    return (
                      <button
                        key={cat.id}
                        onClick={() => openFilePicker(cat.accept)}
                        className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        <Icon size={15} className="shrink-0 text-muted-foreground" />
                        <span className="whitespace-nowrap">{cat.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Model selector */}
            <div ref={modelMenuRef} className="relative">
              <button
                onClick={() => setModelMenuOpen(o => !o)}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Select model"
              >
                <span>{selectedModelObj?.label ?? 'Auto'}</span>
                <ChevronDown size={12} className={modelMenuOpen ? 'rotate-180' : ''} />
              </button>
              {modelMenuOpen && (
                <div className="scrollbar-hidden absolute bottom-full left-0 mb-1 z-50 w-72 rounded-xl border border-border bg-popover shadow-lg py-1 max-h-80 overflow-y-auto">
                  {models.map(model => (
                    <button
                      key={model.id}
                      onClick={() => { onSelectModel?.(model.id); setModelMenuOpen(false) }}
                      className={cn(
                        'flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors',
                        model.id === selectedModel && 'bg-muted/50'
                      )}
                    >
                      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border">
                        {model.id === selectedModel && <Check size={10} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground">{model.label}</span>
                          {model.experimental && <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Dev</span>}
                          <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{model.vendor}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">{model.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Send / Stop */}
          {isGenerating ? (
            <button
              onClick={onStop}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
              title="Stop"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                canSend
                  ? 'bg-foreground text-background hover:opacity-80'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
              title="Send"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
      </BorderBeam>

      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
        Nyx Agent can make mistakes. Check important info.
      </p>
    </div>
  )
}
