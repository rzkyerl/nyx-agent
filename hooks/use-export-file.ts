'use client'

/* ═══════════════════════════════════════════════════
   useExportFile — detects export-config block in AI
   response, calls /api/export, and triggers download.
═══════════════════════════════════════════════════ */

import { useState, useCallback, useEffect } from 'react'
import type { ExportType } from '@/app/api/export/route'

// ── Types ──────────────────────────────────────────

export interface ExportConfig {
  type:      ExportType
  title:     string
  filename:  string
}

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
 */
export function extractExportContent(content: string): string {
  const idx = content.search(EXPORT_CONFIG_RE)
  return idx >= 0 ? content.slice(0, idx).trimEnd() : content.trimEnd()
}

// ── Hook ───────────────────────────────────────────

export function useExportFile() {
  const [state, setState] = useState<ExportState>({
    loading: false,
    error:   null,
    done:    false,
  })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const requestExport = useCallback(async (config: ExportConfig, content: string, rows?: string[][]) => {
    const body: Record<string, unknown> = {
      type: config.type,
      title: config.title,
      filename: config.filename,
      content,
    }
    if (rows && rows.length > 0) body.rows = rows

    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
      throw new Error(err.error || `Export failed: HTTP ${res.status}`)
    }
    return res.blob()
  }, [])

  const exportFile = useCallback(
    async (config: ExportConfig, content: string, rows?: string[][]) => {
      setState({ loading: true, error: null, done: false })
      try {
        // Read binary and trigger browser download
        const blob     = await requestExport(config, content, rows)
        const url      = URL.createObjectURL(blob)
        const anchor   = document.createElement('a')
        const ext      = config.type === 'docx' ? 'docx' : config.type === 'xlsx' ? 'xlsx' : 'pdf'
        anchor.href     = url
        anchor.download = `${config.filename}.${ext}`
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        URL.revokeObjectURL(url)

        setState({ loading: false, error: null, done: true })
        // Reset "done" after 3s so the button can be clicked again
        setTimeout(() => setState(s => ({ ...s, done: false })), 3000)
      } catch (err) {
        setState({
          loading: false,
          error:   err instanceof Error ? err.message : 'Export gagal.',
          done:    false,
        })
      }
    },
    [requestExport]
  )

  const previewFile = useCallback(async (config: ExportConfig, content: string, rows?: string[][]) => {
    const blob = await requestExport(config, content, rows)
    setPreviewUrl(previous => {
      if (previous) URL.revokeObjectURL(previous)
      return URL.createObjectURL(blob)
    })
    return blob.type
  }, [requestExport])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  return { exportFile, previewFile, previewUrl, ...state }
}
