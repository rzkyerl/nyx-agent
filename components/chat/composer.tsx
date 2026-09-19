'use client'

/* ═══════════════════════════════════════════════════
   Composer — Textarea + file upload + model selector + send
   Ported from Composer.jsx (Vite project)
═══════════════════════════════════════════════════ */

import { useRef, useEffect, useCallback, useState } from 'react'
import { Paperclip, Plus, ArrowUp, Square, X, ChevronDown, Check, ChevronRight, Blocks, WandSparkles, Globe, BrainCircuit, Trash2, Settings2, RefreshCw, CircleCheck, CircleX, CircleDashed, Pencil, Network, Info } from 'lucide-react'
import { FILE_CONFIG, getFileIcon, formatFileSize, processFile } from '@/lib/file-utils'
import { saveCustomProviders, type ChatFile, type CustomProvider } from '@/lib/storage'
import type { NyxModel } from '@/lib/models'
import { getSkillDescription, getTriggeredSkills, loadInstalledSkills, parseSkillMetadata, saveInstalledSkills, type InstalledSkill } from '@/lib/skills'
import { cn } from '@/lib/utils'
import { BorderBeam } from '@/components/ui/border-beam'

interface ComposerProps {
  onSend:          (text: string, files?: ChatFile[], options?: { webSearch: boolean; skills: InstalledSkill[] }) => void
  onStop:          () => void
  isGenerating:    boolean
  enterToSend?:    boolean
  selectedModel?:  string
  onSelectModel?:  (id: string) => void
  models?:         NyxModel[]
  customProviders?: CustomProvider[]
  onCustomProvidersChange?: (providers: CustomProvider[]) => void
}

async function readZipSkill(file: File): Promise<{ name: string; content: string } | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const decoder = new TextDecoder()
  let offset = 0

  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength))
    const dataStart = offset + 30 + nameLength + extraLength
    const compressed = bytes.slice(dataStart, dataStart + compressedSize)
    offset = dataStart + compressedSize

    if (!/\/skill\.md$/i.test(`/${name}`) || name.endsWith('/')) continue
    let content: string
    if (method === 0) {
      content = decoder.decode(compressed)
    } else if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      content = decoder.decode(await new Response(stream).arrayBuffer())
    } else {
      continue
    }
    if (content.trim()) return { name, content }
  }

  return null
}

export function Composer({
  onSend, onStop, isGenerating,
  enterToSend = true, selectedModel = 'auto',
  onSelectModel, models = [],
  customProviders = [], onCustomProvidersChange,
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
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false)
  const [manageSkillsOpen, setManageSkillsOpen] = useState(false)
  const [manageModelsOpen, setManageModelsOpen] = useState(false)
  const [modelHealth, setModelHealth] = useState<Record<string, { status: 'ready' | 'unavailable' | 'not-configured'; latencyMs?: number; message?: string }>>({})
  const [checkingModels, setCheckingModels] = useState(false)
  const [checkingModelIds, setCheckingModelIds] = useState<string[]>([])
  const [customProviderFormOpen, setCustomProviderFormOpen] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [customProviderForm, setCustomProviderForm] = useState({ name: '', baseUrl: '', apiKey: '', modelId: '', modelLabel: '', directConnection: false })
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; label: string; description?: string }>>([])
  const [selectedDiscoveredModels, setSelectedDiscoveredModels] = useState<string[]>([])
  const [apiKeyCheck, setApiKeyCheck] = useState<{ status: 'idle' | 'checking' | 'valid' | 'invalid'; message?: string }>({ status: 'idle' })
  const [webSearch, setWebSearch] = useState(false)
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [slashMenuIndex, setSlashMenuIndex] = useState(0)
  const [fileAccept, setFileAccept]       = useState(FILE_CONFIG.accept)
  const [composerFocused, setComposerFocused] = useState(false)

  const selectedModelObj = models.find(m => m.id === selectedModel) || models[0]

  const addCustomProvider = () => {
    const name = customProviderForm.name.trim()
    const baseUrl = customProviderForm.baseUrl.trim().replace(/\/$/, '')
    const manualModelId = customProviderForm.modelId.trim()
    const selectedModels = discoveredModels.filter(model => selectedDiscoveredModels.includes(model.id))
    if (!name || !baseUrl || (selectedModels.length === 0 && !manualModelId)) return
    const manualModel = manualModelId
      ? [{ id: manualModelId, label: customProviderForm.modelLabel.trim() || manualModelId, description: 'Custom model added manually' }]
      : []
    const provider: CustomProvider = {
      id: editingProviderId || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
      name,
      baseUrl,
      apiKey: customProviderForm.apiKey,
      directConnection: customProviderForm.directConnection,
      models: [...selectedModels, ...manualModel.filter(model => !selectedModels.some(selected => selected.id === model.id))],
    }
    const next = editingProviderId
      ? customProviders.map(item => item.id === editingProviderId ? provider : item)
      : [...customProviders, provider]
    saveCustomProviders(next)
    onCustomProvidersChange?.(next)
    setCustomProviderForm({ name: '', baseUrl: '', apiKey: '', modelId: '', modelLabel: '', directConnection: false })
    setDiscoveredModels([])
    setSelectedDiscoveredModels([])
    setEditingProviderId(null)
    setCustomProviderFormOpen(false)
  }

  const editCustomProvider = (provider: CustomProvider) => {
    const firstModel = provider.models[0]
    setEditingProviderId(provider.id)
    setCustomProviderForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      modelId: firstModel?.id || '',
      modelLabel: firstModel?.label || '',
      directConnection: provider.directConnection,
    })
    setDiscoveredModels(provider.models)
    setSelectedDiscoveredModels(provider.models.map(model => model.id))
    setCustomProviderFormOpen(true)
  }

  const checkCustomApiKey = async () => {
    const { baseUrl, apiKey, directConnection } = customProviderForm
    if (!baseUrl.trim() || !apiKey.trim()) {
      setApiKeyCheck({ status: 'invalid', message: 'Enter a base URL and API key first.' })
      return
    }
    setApiKeyCheck({ status: 'checking' })
    try {
      const endpoint = `${baseUrl.trim().replace(/\/$/, '')}${baseUrl.trim().endsWith('/v1') ? '/models' : '/v1/models'}`
      const response = directConnection
        ? await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey.trim()}` }, signal: AbortSignal.timeout(7000) })
        : await fetch('/api/providers/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl, apiKey }),
          })
      const data = await response.json().catch(() => ({})) as { valid?: boolean; message?: string; models?: Array<{ id: string; label: string; description?: string }> }
      if (directConnection && response.ok) {
        const directData = data as { data?: Array<{ id: string; owned_by?: string }>; models?: Array<{ id: string; name?: string; owned_by?: string }> }
        const models = (directData.data || directData.models || []).filter(model => model?.id).map(model => ({ id: model.id, label: String(('name' in model && model.name) || model.id), description: model.owned_by ? `Provided by ${model.owned_by}` : 'Available model' }))
        setDiscoveredModels(models)
        setSelectedDiscoveredModels(models.map(model => model.id))
      }
      if (data.models) {
        setDiscoveredModels(data.models)
        setSelectedDiscoveredModels(data.models.map(model => model.id))
      }
      setApiKeyCheck(data.valid || (directConnection && response.ok)
        ? { status: 'valid', message: 'API key is valid.' }
        : { status: 'invalid', message: data.message || `Provider rejected the key (${response.status}).` })
    } catch {
      setApiKeyCheck({ status: 'invalid', message: directConnection ? 'Could not reach the provider from this browser.' : 'Could not reach the validation service.' })
    }
  }

  const checkModels = useCallback(async () => {
    setCheckingModels(true)
    try {
      const response = await fetch('/api/models/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: models.map(model => ({ id: model.id })), customProviders }),
      })
      if (!response.ok) throw new Error('Health check failed')
      const data = await response.json() as { results?: Array<{ id: string; status: 'ready' | 'unavailable' | 'not-configured'; latencyMs?: number; message?: string }> }
      setModelHealth(Object.fromEntries((data.results || []).map(result => [result.id, result])))
    } catch {
      setModelHealth(Object.fromEntries(models.map(model => [model.id, { id: model.id, status: 'unavailable' as const, message: 'Health check failed' }])))
    } finally { setCheckingModels(false) }
  }, [models, customProviders])

  const checkModel = useCallback(async (modelId: string) => {
    setCheckingModelIds(ids => ids.includes(modelId) ? ids : [...ids, modelId])
    try {
      const response = await fetch('/api/models/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: [{ id: modelId }], customProviders }),
      })
      if (!response.ok) throw new Error('Health check failed')
      const data = await response.json() as { results?: Array<{ id: string; status: 'ready' | 'unavailable' | 'not-configured'; latencyMs?: number; message?: string }> }
      const result = data.results?.[0]
      if (result) setModelHealth(current => ({ ...current, [result.id]: result }))
    } catch {
      setModelHealth(current => ({ ...current, [modelId]: { status: 'unavailable', message: 'Health check failed' } }))
    } finally {
      setCheckingModelIds(ids => ids.filter(id => id !== modelId))
    }
  }, [customProviders])

  useEffect(() => {
    const skills = loadInstalledSkills()
    const frame = requestAnimationFrame(() => {
      setInstalledSkills(skills)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

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
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setModelMenuOpen(false); setFileMenuOpen(false); setSkillsMenuOpen(false); setManageSkillsOpen(false) } }
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

  const addSkill = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const entry = file.name.toLowerCase().endsWith('.zip')
      ? await readZipSkill(file)
      : /(^|\/)skill\.md$/i.test(file.name)
        ? { name: file.name, content: await file.text() }
        : null
    if (!entry) {
      setFileError('A skill must contain a file named SKILL.md')
      return
    }
    const fallbackName = entry.name.split('/').pop()?.replace(/\.md$/i, '') || 'Skill'
    const metadata = parseSkillMetadata(entry.content, fallbackName)
    const addition = {
      id: `${metadata.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...metadata,
      content: entry.content,
    }
    const next = [...installedSkills.filter(skill => skill.name !== addition.name), addition]
    setInstalledSkills(next)
    saveInstalledSkills(next)
  }, [installedSkills])

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
  const handlePaste     = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.items || []).filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => f !== null)
    if (pasted.length) { e.preventDefault(); addFiles(pasted); return }

    const pastedText = e.clipboardData?.getData('text/plain')
    if (!pastedText) return

    e.preventDefault()
    const textarea = e.currentTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const nextValue = value.slice(0, start) + pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n') + value.slice(end)
    const nextCursor = start + pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').length
    setValue(nextValue)
    requestAnimationFrame(() => {
      textarea.selectionStart = nextCursor
      textarea.selectionEnd = nextCursor
    })
  }, [addFiles, value])

  const slashMatch = value.match(/(?:^|\s)\/([^\s]*)$/)
  const slashQuery = slashMatch?.[1].toLowerCase() || ''
  const slashSkills = slashMatch
    ? installedSkills.filter(skill => `${skill.name} ${getSkillDescription(skill)}`.toLowerCase().includes(slashQuery))
    : []
  const slashOptions = slashMatch ? [{ type: 'files' as const }, ...slashSkills.map(skill => ({ type: 'skill' as const, skill }))] : []
  const slashMenuOpen = slashOptions.length > 0
  const selectSlashSkill = useCallback((skill: InstalledSkill) => {
    setValue(current => current.replace(/(?:^|\s)\/[^\s]*$/, match => `${match.startsWith(' ') ? ' ' : ''}/${skill.name} `))
    setSlashMenuIndex(0)
  }, [])

  const selectSlashOption = (index: number) => {
    const option = slashOptions[index]
    if (!option) return
    if (option.type === 'files') {
      setValue(current => current.replace(/(?:^|\s)\/[^\s]*$/, match => match.startsWith(' ') ? ' ' : ''))
      openFilePicker(FILE_CONFIG.accept)
      return
    }
    selectSlashSkill(option.skill)
  }

  const canSend = (value.trim().length > 0 || files.length > 0) && !isGenerating && !isExtracting
  const handleSend = useCallback(() => {
    if (!canSend) return
    onSend(value.trim(), files.length > 0 ? files : undefined, { webSearch, skills: getTriggeredSkills(installedSkills, value.trim()) })
    setValue(''); setFiles([]); setFileError(null)
    requestAnimationFrame(() => { if (textareaRef.current) textareaRef.current.style.height = 'auto' })
  }, [canSend, value, files, onSend, webSearch, installedSkills])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen && e.key === 'ArrowDown') {
      e.preventDefault(); setSlashMenuIndex(index => Math.min(index + 1, slashOptions.length - 1)); return
    }
    if (slashMenuOpen && e.key === 'ArrowUp') {
      e.preventDefault(); setSlashMenuIndex(index => Math.max(index - 1, 0)); return
    }
    if (slashMenuOpen && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault(); selectSlashOption(slashMenuIndex); return
    }
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
        brightness={1.35}
        strength={1}
        borderRadius={16}
        className="rounded-2xl"
        style={{ overflow: 'visible' }}
      >
      <div
        className="composer-shell rounded-2xl border border-border bg-card shadow-sm"
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
        <input id="skill-file-input" type="file" accept=".md,.zip,text/markdown,application/zip" style={{ display: 'none' }} onChange={addSkill} />

        {/* Textarea */}
        <div className="relative">
          {slashMenuOpen && (
            <div className="absolute bottom-full left-3 z-50 mb-2 w-60 rounded-xl border border-border bg-popover p-1.5 shadow-xl">
              <button
                onMouseDown={event => event.preventDefault()}
                onClick={() => selectSlashOption(0)}
                className={cn('flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-foreground', slashMenuIndex === 0 ? 'bg-muted' : 'hover:bg-muted')}
              >
                <Paperclip size={15} className="shrink-0 text-muted-foreground" />
                <span>Add files</span>
              </button>
              {slashSkills.map((skill, index) => (
                <button
                  key={skill.id}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectSlashOption(index + 1)}
                  className={cn('flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-foreground', slashMenuIndex === index + 1 ? 'bg-muted' : 'hover:bg-muted')}
                >
                  <WandSparkles size={15} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{skill.name}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="composer-textarea-scrollbar relative z-10 w-full resize-none bg-transparent px-4 pt-3 pb-2 text-base sm:text-sm leading-normal text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder="Build anything…"
            value={value}
            spellCheck={false}
            onChange={e => { setValue(e.target.value); setSlashMenuIndex(0) }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
          />
        </div>

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
                <Plus size={16} />
              </button>
              {fileMenuOpen && (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-[280px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-1.5 shadow-lg">
                  <button onClick={() => openFilePicker(FILE_CONFIG.accept)} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted">
                    <Paperclip size={15} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1 whitespace-nowrap">Add files or photos</span>
                    <span className="text-[11px] text-muted-foreground">Ctrl+U</span>
                  </button>
                  <div className="relative" onMouseEnter={() => setSkillsMenuOpen(true)} onMouseLeave={() => setSkillsMenuOpen(false)}>
                    <button
                      type="button"
                      onClick={() => setSkillsMenuOpen(open => !open)}
                      className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                    >
                      <Blocks size={15} className="shrink-0 text-muted-foreground" /><span className="flex-1">Skills</span><ChevronRight size={14} className="hidden sm:block" /><ChevronDown size={14} className="sm:hidden" />
                    </button>
                    {skillsMenuOpen && (
                      <div className="absolute bottom-[calc(100%+0.25rem)] right-0 z-50 max-h-[min(60vh,20rem)] w-56 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl sm:bottom-0 sm:left-full sm:right-auto sm:ml-1">
                        {installedSkills.length > 0 ? installedSkills.map(skill => (
                          <button key={skill.id} onClick={() => setSkillsMenuOpen(false)} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted">
                            <WandSparkles size={14} className="text-muted-foreground" /><span className="min-w-0 truncate">{skill.name}</span>
                          </button>
                        )) : <p className="px-3 py-2 text-xs text-muted-foreground">Not Installed Skill</p>}
                        <div className="my-1 border-t border-border" />
                        <label htmlFor="skill-file-input" className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-foreground hover:bg-muted">
                          <Plus size={15} /><span>Add Skills</span>
                        </label>
                        <button onClick={() => setManageSkillsOpen(true)} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted">
                          <Settings2 size={15} /><span>Manage skills</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setWebSearch(search => !search); setFileMenuOpen(false) }} className={cn('flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted', webSearch ? 'text-foreground' : 'text-foreground')}>
                    <Globe size={15} className="shrink-0 text-muted-foreground" /><span className="flex-1">Web search</span>{webSearch && <Check size={15} className="text-primary" />}
                  </button>
                  <button onClick={() => setFileMenuOpen(false)} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted">
                    <BrainCircuit size={15} className="shrink-0 text-muted-foreground" /><span>Memory</span><Check size={15} className="text-primary" />
                  </button>
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
                  <div className="my-1 border-t border-border" />
                  <button
                    onClick={() => { setModelMenuOpen(false); setManageModelsOpen(true); void checkModels() }}
                    className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Settings2 size={15} className="shrink-0" />
                    <span>Manage Models</span>
                  </button>
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

      {manageSkillsOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setManageSkillsOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Skills</h2>
                <p className="mt-1 text-xs text-muted-foreground">Configure and manage your installed skills.</p>
              </div>
              <button onClick={() => setManageSkillsOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close skills settings">
                <X size={17} />
              </button>
            </div>
            <div className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Installed skills</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Skills are loaded when your message matches their description.</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{installedSkills.length}</span>
              </div>
              {installedSkills.length > 0 ? (
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {installedSkills.map(skill => (
                    <div key={skill.id} className="flex items-start gap-3 rounded-xl border border-border px-3 py-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><WandSparkles size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{skill.name}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{getSkillDescription(skill)}</p>
                      </div>
                      <button
                        onClick={() => {
                          const next = installedSkills.filter(item => item.id !== skill.id)
                          setInstalledSkills(next)
                          saveInstalledSkills(next)
                        }}
                        className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title={`Uninstall ${skill.name}`}
                        aria-label={`Uninstall ${skill.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">No skills installed</p>
              )}
              <label htmlFor="skill-file-input" className="mt-4 flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90">
                <Plus size={15} />
                Add skill
              </label>
            </div>
          </div>
        </div>
      )}

      {manageModelsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-4" onClick={() => setManageModelsOpen(false)}>
          <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:max-h-[min(86vh,48rem)]" onClick={event => event.stopPropagation()}>
            <div className="flex shrink-0 items-start justify-between border-b border-border px-4 py-3.5 sm:px-5 sm:py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Manage Models</h2>
                <p className="mt-1 max-w-[19rem] text-xs leading-4 text-muted-foreground">Check which models are ready to use with your configured providers.</p>
              </div>
              <button onClick={() => setManageModelsOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close manage models">
                <X size={17} />
              </button>
            </div>
            <div className="model-list-scrollbar min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
              <div className="space-y-2.5">
                {models.map(model => {
                  const health = modelHealth[model.id]
                  const status = health?.status
                  return (
                    <div key={model.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border border-border px-2.5 py-2.5 sm:flex sm:gap-3 sm:px-3 sm:py-3">
                      <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:flex"><CircleDashed size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">{model.label}</p>
                          {model.vendor === 'Ollama' && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Dev</span>}
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{model.vendor}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{model.description}{model.vendor === 'Ollama' && ' Available when the developer Ollama server is running.'}</p>
                        <div className="mt-1 flex items-center gap-2 sm:hidden">
                          {health?.latencyMs && <span className="text-[10px] text-muted-foreground">{health.latencyMs} ms</span>}
                          <span className={cn('flex items-center gap-1 text-[10px] font-medium', status === 'ready' ? 'text-emerald-600 dark:text-emerald-400' : status === 'unavailable' ? 'text-destructive' : status === 'not-configured' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                            {status === 'ready' ? <CircleCheck size={13} /> : status === 'unavailable' ? <CircleX size={13} /> : <CircleDashed size={13} />}
                            {status === 'ready' ? 'Ready' : status === 'unavailable' ? 'Unavailable' : status === 'not-configured' ? 'Not configured' : 'Not checked'}
                          </span>
                        </div>
                      </div>
                      <div className="col-span-1 flex shrink-0 items-center justify-end gap-1.5 sm:ml-auto sm:gap-2">
                        <span className="hidden text-[10px] text-muted-foreground sm:inline sm:text-[11px]">{health?.latencyMs ? `${health.latencyMs} ms` : ''}</span>
                        <span className={cn('hidden items-center gap-1 text-[10px] font-medium sm:flex sm:text-[11px]', status === 'ready' ? 'text-emerald-600 dark:text-emerald-400' : status === 'unavailable' ? 'text-destructive' : status === 'not-configured' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                          {status === 'ready' ? <CircleCheck size={14} /> : status === 'unavailable' ? <CircleX size={14} /> : <CircleDashed size={14} />}
                          {status === 'ready' ? 'Ready' : status === 'unavailable' ? 'Unavailable' : status === 'not-configured' ? 'Not configured' : 'Not checked'}
                        </span>
                        <button onClick={() => void checkModel(model.id)} disabled={checkingModels || checkingModelIds.includes(model.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50" title={`Check ${model.label}`} aria-label={`Check ${model.label}`}>
                          <RefreshCw size={13} className={checkingModelIds.includes(model.id) ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={() => { onSelectModel?.(model.id); setManageModelsOpen(false) }} className="rounded-lg bg-muted px-2.5 py-1.5 text-[10px] font-medium text-foreground hover:bg-border sm:text-[11px]">Use</button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-5 border-t border-border pt-4">
                    <div className="mb-3 flex gap-2.5 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3.5 py-3 text-[11px] leading-relaxed text-blue-700 dark:text-blue-400">
                      <Network size={13} className="mt-0.5 shrink-0" />
                      <span>
                        <strong className="font-semibold">Using a local provider?</strong> Your server must be reachable via HTTPS.
                        Use <strong className="font-medium">Tailscale Funnel</strong> (<code className="rounded bg-blue-500/10 px-1">tailscale funnel 11434</code>),{' '}
                        <strong className="font-medium">ngrok</strong> (<code className="rounded bg-blue-500/10 px-1">ngrok http 11434</code>),
                        or <strong className="font-medium">Cloudflare Tunnel</strong> to expose your endpoint, then paste the HTTPS URL below.
                      </span>
                    </div>
                    <button onClick={() => { setEditingProviderId(null); setCustomProviderFormOpen(open => !open) }} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border px-3 py-3 text-left transition-colors hover:bg-muted">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Plus size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">Add custom provider</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">Add a custom provider by base URL</span>
                  </span>
                  <ChevronRight size={15} className={cn('text-muted-foreground transition-transform', customProviderFormOpen && 'rotate-90')} />
                </button>
                {customProviderFormOpen && (
                  <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/30 p-3">
                    <input value={customProviderForm.name} onChange={event => setCustomProviderForm(form => ({ ...form, name: event.target.value }))} placeholder="Provider name" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring" />
                    <input value={customProviderForm.baseUrl} onChange={event => setCustomProviderForm(form => ({ ...form, baseUrl: event.target.value }))} placeholder="Base URL, e.g. https://openrouter.ai/api/v1" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring" />
                    <div className="flex gap-2">
                      <input type="password" value={customProviderForm.apiKey} onChange={event => { setCustomProviderForm(form => ({ ...form, apiKey: event.target.value })); setApiKeyCheck({ status: 'idle' }) }} placeholder="API key (optional for local providers)" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring" />
                      <button onClick={checkCustomApiKey} disabled={apiKeyCheck.status === 'checking'} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-50">
                        {apiKeyCheck.status === 'checking' ? <RefreshCw size={13} className="animate-spin" /> : apiKeyCheck.status === 'valid' ? <CircleCheck size={13} className="text-emerald-500" /> : apiKeyCheck.status === 'invalid' ? <CircleX size={13} className="text-destructive" /> : null}
                        Check
                      </button>
                    </div>
                    {apiKeyCheck.message && <p className={cn('text-[11px]', apiKeyCheck.status === 'valid' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>{apiKeyCheck.message}</p>}
                    {discoveredModels.length > 0 && (
                      <div className="space-y-2 rounded-lg border border-border bg-background p-2">
                        <div className="flex items-center justify-between gap-2 px-1">
                          <p className="text-[11px] font-medium text-muted-foreground">Models available from {customProviderForm.name || 'this provider'}</p>
                          <div className="flex shrink-0 gap-1">
                            <button type="button" onClick={() => setSelectedDiscoveredModels(discoveredModels.map(model => model.id))} className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">Select all</button>
                            <button type="button" onClick={() => setSelectedDiscoveredModels([])} className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">Unselect all</button>
                          </div>
                        </div>
                        <div className="max-h-40 space-y-1 overflow-y-auto">
                          {discoveredModels.map(model => (
                            <label key={model.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                              <input type="checkbox" checked={selectedDiscoveredModels.includes(model.id)} onChange={event => setSelectedDiscoveredModels(ids => event.target.checked ? [...ids, model.id] : ids.filter(id => id !== model.id))} className="mt-0.5" />
                              <span className="min-w-0"><span className="block truncate text-xs text-foreground">{model.id}</span><span className="block truncate text-[10px] text-muted-foreground">{model.description}</span></span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="space-y-2 rounded-lg border border-border bg-background p-2">
                      <p className="px-1 text-[11px] font-medium text-muted-foreground">Optional manual model</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={customProviderForm.modelId} onChange={event => setCustomProviderForm(form => ({ ...form, modelId: event.target.value }))} placeholder="Models ID" className="h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring" />
                        <input value={customProviderForm.modelLabel} onChange={event => setCustomProviderForm(form => ({ ...form, modelLabel: event.target.value }))} placeholder="Models Name" className="h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring" />
                      </div>
                      <p className="px-1 text-[10px] text-muted-foreground">Use this when the model is not returned by the provider API.</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={customProviderForm.directConnection} onChange={event => setCustomProviderForm(form => ({ ...form, directConnection: event.target.checked }))} /> Direct connection for local/private URL</label>
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">API keys are stored in this browser and sent only with provider requests.</p>
                    <button onClick={addCustomProvider} disabled={!customProviderForm.name.trim() || !customProviderForm.baseUrl.trim() || (selectedDiscoveredModels.length === 0 && !customProviderForm.modelId.trim())} className="w-full rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background disabled:cursor-not-allowed disabled:opacity-40">{editingProviderId ? 'Save changes' : 'Add provider'}</button>
                  </div>
                )}
              </div>
              {customProviders.length > 0 && (
                <div className="mt-4 space-y-2">
                  {customProviders.map(provider => (
                    <div key={provider.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <div className="min-w-0"><p className="truncate text-xs font-medium text-foreground">{provider.name}</p><p className="truncate text-[11px] text-muted-foreground">{provider.baseUrl}</p></div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => editCustomProvider(provider)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${provider.name}`} title={`Edit ${provider.name}`}><Pencil size={14} /></button>
                        <button onClick={() => { const next = customProviders.filter(item => item.id !== provider.id); saveCustomProviders(next); onCustomProvidersChange?.(next) }} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove ${provider.name}`}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
              <p className="max-w-[12rem] text-[10px] leading-4 text-muted-foreground sm:max-w-none sm:text-[11px]">Health checks run securely through the server.</p>
              <button onClick={checkModels} disabled={checkingModels} className="flex shrink-0 items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
                <RefreshCw size={13} className={checkingModels ? 'animate-spin' : ''} />
                {checkingModels ? 'Checking...' : 'Check all models'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
