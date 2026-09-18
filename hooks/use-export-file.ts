'use client'

/* ═══════════════════════════════════════════════════
   useExportFile — detects export-config block in AI
   response, calls /api/export, and triggers download.
═══════════════════════════════════════════════════ */

import { useState, useCallback } from 'react'
import type { ExportFont, ExportType } from '@/app/api/export/route'

export type { ExportFont }

// ── Types ──────────────────────────────────────────

export interface ExportConfig {
  type:      ExportType
  title:     string
  filename:  string
  template:  ExportTemplate
  font:      ExportFont
}

export type ExportTemplate = 'auto' | 'academic' | 'formal' | 'informal'

export interface ExportState {
  loading:  boolean
  error:    string | null
  done:     boolean
}

// ── Parser ─────────────────────────────────────────

const EXPORT_CONFIG_RE = /```export-config\s*([\s\S]*?)```/i

/**
 * Extracts the export-config JSON block from an AI message string.
 * Returns null if not found or JSON is malformed.
 */
export function parseExportConfig(content: string): ExportConfig | null {
  const match = EXPORT_CONFIG_RE.exec(content)
  if (!match) return null
  try {
    const raw = JSON.parse(match[1].trim()) as Partial<ExportConfig>
    if (!raw.type || !['pdf', 'docx', 'xlsx'].includes(raw.type)) return null
    return {
      type:     raw.type,
      title:    raw.title    || 'Dokumen',
      filename: raw.filename || 'export',
      template: raw.template && ['auto', 'academic', 'formal', 'informal'].includes(raw.template)
        ? raw.template as ExportTemplate
        : 'auto',
      font: raw.font && ['auto', 'Inter', 'Lora', 'Playfair Display', 'Merriweather', 'Roboto', 'Open Sans', 'Montserrat', 'Source Sans 3'].includes(raw.font)
        ? raw.font as ExportFont
        : 'auto',
    }
  } catch {
    return null
  }
}

/**
 * Strips the export-config block from AI content so it isn't
 * rendered as a code block in the markdown renderer.
 */
export function stripExportConfig(content: string): string {
  return content.replace(EXPORT_CONFIG_RE, '').trimEnd()
}

/**
 * Extracts the "content" part of an AI message — everything before
 * the export-config fence — to be used as the document body.
 *
 * Fallback: if nothing exists before the fence (model output the block
 * immediately without any explanation), strip the block and use the
 * rest of the message so /api/export never receives an empty body.
 */
export function extractExportContent(content: string): string {
  const idx = content.search(EXPORT_CONFIG_RE)
  if (idx < 0) return content.trimEnd()
  const before = content.slice(0, idx).trimEnd()
  if (before.length > 0) return before
  return content.replace(EXPORT_CONFIG_RE, '').trimEnd()
}

// ── Core fetch ─────────────────────────────────────

async function fetchExportBlob(config: ExportConfig, content: string, rows?: string[][]): Promise<Blob> {
  const body: Record<string, unknown> = {
    type:     config.type,
    title:    config.title,
    filename: config.filename,
    template: config.template,
    font:     config.font,
    content,
  }
  if (rows && rows.length > 0) body.rows = rows

  const res = await fetch('/api/export', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
    throw new Error(err.error || `Export failed: HTTP ${res.status}`)
  }

  return res.blob()
}

async function fetchExportPreviewHtml(config: ExportConfig, content: string, rows?: string[][]): Promise<string> {
  const body: Record<string, unknown> = {
    type:     config.type,
    title:    config.title,
    filename: config.filename,
    template: config.template,
    font:     config.font,
    content,
    preview:  true,
  }
  if (rows && rows.length > 0) body.rows = rows

  const res = await fetch('/api/export', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
    throw new Error(err.error || `Preview failed: HTTP ${res.status}`)
  }

  return res.text()
}

// ── Hook ───────────────────────────────────────────

export function useExportFile() {
  const [state, setState] = useState<ExportState>({
    loading: false,
    error:   null,
    done:    false,
  })

  const exportFile = useCallback(
    async (config: ExportConfig, content: string, rows?: string[][]) => {
      setState({ loading: true, error: null, done: false })
      try {
        const blob   = await fetchExportBlob(config, content, rows)
        const url    = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        const ext    = config.type === 'docx' ? 'docx' : config.type === 'xlsx' ? 'xlsx' : 'pdf'
        anchor.href     = url
        anchor.download = `${config.filename}.${ext}`
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        URL.revokeObjectURL(url)

        setState({ loading: false, error: null, done: true })
        setTimeout(() => setState(s => ({ ...s, done: false })), 3000)
      } catch (err) {
        setState({
          loading: false,
          error:   err instanceof Error ? err.message : 'Export gagal.',
          done:    false,
        })
      }
    },
    []
  )

  /** Returns the raw blob so the caller can render it however needed (PDF). */
  const fetchBlob = useCallback(
    (config: ExportConfig, content: string, rows?: string[][]) =>
      fetchExportBlob(config, content, rows),
    []
  )

  /** Returns rendered HTML string for DOCX / XLSX preview (server-side). */
  const fetchPreviewHtml = useCallback(
    (config: ExportConfig, content: string, rows?: string[][]) =>
      fetchExportPreviewHtml(config, content, rows),
    []
  )

  return { exportFile, fetchBlob, fetchPreviewHtml, ...state }
}
