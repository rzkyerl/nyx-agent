/* ═══════════════════════════════════════════════════
   Nyx Agent — /api/export
   Generates downloadable files (PDF / DOCX / XLSX)
   from structured content sent by the chat frontend.

   POST body:
   {
     type:     'pdf' | 'docx' | 'xlsx'
     title?:   string
     content:  string          // markdown-ish plain text (PDF / DOCX)
     rows?:    string[][]      // table rows for XLSX [[header...], [row...], ...]
     filename?: string         // suggested filename (without extension)
   }
═══════════════════════════════════════════════════ */

import { NextRequest } from 'next/server'

// ── Types ──────────────────────────────────────────

export type ExportType = 'pdf' | 'docx' | 'xlsx'
export type ExportTemplate = 'auto' | 'academic' | 'formal' | 'informal'
export type ExportFont = 'auto' | 'Inter' | 'Lora' | 'Playfair Display' | 'Merriweather' | 'Roboto' | 'Open Sans' | 'Montserrat' | 'Source Sans 3'

const GOOGLE_FONTS = new Set<Exclude<ExportFont, 'auto'>>([
  'Inter', 'Lora', 'Playfair Display', 'Merriweather', 'Roboto', 'Open Sans', 'Montserrat', 'Source Sans 3',
])
const registeredFonts = new Set<string>()

// ── Local font map — files bundled in public/fonts/ ───────────────────────────
// Keys are font family names as used in @react-pdf/renderer.
// Each entry provides the path (relative to process.cwd()) for regular and bold.
// This completely avoids any network calls during PDF generation.
const LOCAL_FONT_MAP: Record<string, { regular: string; bold: string }> = {
  'Inter':            { regular: 'public/fonts/Inter-Regular.woff2',            bold: 'public/fonts/Inter-Bold.woff2' },
  'Lora':             { regular: 'public/fonts/Lora-Regular.woff2',             bold: 'public/fonts/Lora-Bold.woff2' },
  'Roboto':           { regular: 'public/fonts/Roboto-Regular.woff2',           bold: 'public/fonts/Roboto-Bold.woff2' },
  'Merriweather':     { regular: 'public/fonts/Merriweather-Regular.woff2',     bold: 'public/fonts/Merriweather-Bold.woff2' },
  'Open Sans':        { regular: 'public/fonts/OpenSans-Regular.woff2',         bold: 'public/fonts/OpenSans-Bold.woff2' },
  'Montserrat':       { regular: 'public/fonts/Montserrat-Regular.woff2',       bold: 'public/fonts/Montserrat-Bold.woff2' },
  'Source Sans 3':    { regular: 'public/fonts/SourceSans3-Regular.woff2',      bold: 'public/fonts/SourceSans3-Bold.woff2' },
  'Playfair Display': { regular: 'public/fonts/PlayfairDisplay-Regular.woff2',  bold: 'public/fonts/PlayfairDisplay-Bold.woff2' },
}

interface ExportRequest {
  type:      ExportType
  title?:    string
  content?:  string
  rows?:     string[][]
  filename?: string
  template?: ExportTemplate
  font?:     ExportFont
  preview?:  boolean
}

// ── Helpers ────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim().slice(0, 80) || 'export'
}

interface DocumentBlock {
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'pageBreak'
  text?: string
  items?: Array<{ text: string; level: number; ordered: boolean }>
  rows?: string[][]
  level?: number
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .trim()
}

function isPageBreakLine(line: string): boolean {
  const normalized = line.trim().replace(/\s+/g, '')
  return /^(?:-{3,}|_{3,}|\*{3,})$/.test(normalized)
}

function parseDocumentBlocks(text: string): DocumentBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: DocumentBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) { index++; continue }

    if (isPageBreakLine(line)) {
      blocks.push({ kind: 'pageBreak' })
      index++; continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: cleanMarkdown(heading[2]) })
      index++; continue
    }

    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const row = lines[index].trim()
        if (!/^\|[\s\-:|]+\|$/.test(row)) {
          rows.push(row.slice(1, -1).split('|').map(cell => cleanMarkdown(cell)))
        }
        index++
      }
      if (rows.length) blocks.push({ kind: 'table', rows })
      continue
    }

    if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      const items: Array<{ text: string; level: number; ordered: boolean }> = []
      while (index < lines.length) {
        const source = lines[index]
        const item = source.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/)
        if (!item) break
        items.push({
          text: cleanMarkdown(item[3]),
          level: Math.floor(item[1].replace(/\t/g, '  ').length / 2),
          ordered: /^\d+\./.test(item[2]),
        })
        index++
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const paragraph: string[] = [line]
    index++
    while (index < lines.length && lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index].trim()) &&
      !lines[index].trim().startsWith('|') &&
      !/^(?:\s*)(?:[-*]|\d+\.)\s+/.test(lines[index])) {
      paragraph.push(lines[index].trim()); index++
    }
    blocks.push({ kind: 'paragraph', text: cleanMarkdown(paragraph.join(' ')) })
  }
  return blocks
}

// ── PDF generator ──────────────────────────────────

function resolveTemplate(template: ExportTemplate | undefined, title: string, content: string): Exclude<ExportTemplate, 'auto'> {
  if (template && template !== 'auto') return template
  const source = `${title} ${content}`.toLowerCase()
  if (/\b(academic|akademik|skripsi|tesis|jurnal|abstrak|abstract|penelitian)\b/.test(source)) return 'academic'
  if (/\b(formal|resmi|proposal|kontrak|surat|laporan)\b/.test(source)) return 'formal'
  return 'informal'
}

function resolveFont(font: ExportFont | undefined, template: Exclude<ExportTemplate, 'auto'>): string {
  if (font && font !== 'auto' && GOOGLE_FONTS.has(font)) return font
  return template === 'academic' ? 'Lora' : template === 'formal' ? 'Source Sans 3' : 'Inter'
}

async function registerLocalFont(
  Font: { register: (options: { family: string; src: string; fontWeight?: number | 'normal' | 'bold' | 'thin' | 'ultralight' | 'light' | 'medium' | 'semibold' | 'ultrabold' | 'heavy' }) => void },
  family: string,
): Promise<string> {
  if (registeredFonts.has(family)) return family

  const paths = LOCAL_FONT_MAP[family]
  if (!paths) {
    console.warn(`[export] no local font for "${family}", falling back to Helvetica`)
    return 'Helvetica'
  }

  try {
    const { existsSync } = await import('fs')
    const { resolve } = await import('path')
    const regularPath = resolve(process.cwd(), paths.regular)
    const boldPath    = resolve(process.cwd(), paths.bold)

    if (!existsSync(regularPath)) throw new Error(`Font file not found: ${regularPath}`)

    Font.register({ family, src: regularPath, fontWeight: 'normal' })
    if (existsSync(boldPath)) {
      Font.register({ family, src: boldPath, fontWeight: 'bold' })
    }

    registeredFonts.add(family)
    return family
  } catch (error) {
    console.warn(`[export] failed to load local font "${family}":`, error)
    return 'Helvetica'
  }
}

async function generatePDF(title: string, content: string, requestedTemplate: ExportTemplate = 'auto', requestedFont: ExportFont = 'auto'): Promise<Buffer> {
  // Dynamic import — @react-pdf/renderer is heavy, only load when needed
  const { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } =
    await import('@react-pdf/renderer')

  Font.registerHyphenationCallback(word => [word])

  const template = resolveTemplate(requestedTemplate, title, content)
  const requestedFamily = resolveFont(requestedFont, template)
  const fontFamily = await registerLocalFont(Font, requestedFamily)
  const fontBoldFamily = fontFamily === 'Helvetica' ? 'Helvetica-Bold' : fontFamily
  const styles = StyleSheet.create({
    page: {
      paddingTop:    48,
      paddingBottom: 48,
      paddingLeft:   56,
      paddingRight:  56,
      fontFamily,
      fontSize:      template === 'academic' ? 11 : template === 'formal' ? 10.5 : 11,
      lineHeight:    template === 'academic' ? 1.7 : template === 'formal' ? 1.55 : 1.65,
      color:         template === 'formal' ? '#263238' : '#1a1a1a',
    },
    title: {
      fontSize:     template === 'academic' ? 22 : 20,
      fontFamily:   fontBoldFamily,
      marginBottom: template === 'academic' ? 14 : 6,
      color:        '#111111',
    },
    divider: {
      borderBottomWidth: 1,
      borderBottomColor: template === 'formal' ? '#334155' : '#e0e0e0',
      marginBottom:      16,
    },
    paragraph: {
      marginBottom: 10,
      textAlign: template === 'formal' ? 'justify' : 'left',
    },
    heading1: {
      fontFamily: fontBoldFamily,
      fontSize: 18,
      marginTop: template === 'academic' ? 22 : 16,
      marginBottom: 8,
    },
    heading2: {
      fontFamily: fontBoldFamily,
      fontSize: 15,
      marginTop: 12,
      marginBottom: 6,
    },
    heading3: {
      fontFamily: fontBoldFamily,
      fontSize: 12,
      marginTop: 10,
      marginBottom: 5,
    },
    listItem: {
      marginBottom: 5,
      paddingLeft: 10,
    },
    listItemNested: {
      marginBottom: 4,
      paddingLeft: 24,
    },
    table: {
      marginTop: 6,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: '#cbd5e1',
    },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: '#cbd5e1',
    },
    tableCell: {
      flex: 1,
      padding: 5,
      fontSize: 8,
    },
    tableHeader: {
      backgroundColor: template === 'academic' ? '#f1f5f9' : '#e2e8f0',
      fontFamily: 'Helvetica-Bold',
    },
    meta: {
      fontSize:     9,
      color:        '#888888',
      marginBottom: 24,
    },
  })

  const blocks = parseDocumentBlocks(content)
  const sectionCounters = [0, 0, 0]
  const numberedBlocks = blocks.map(block => {
    if (template !== 'formal' || block.kind !== 'heading' || !block.level) return block
    sectionCounters[block.level - 1]++
    for (let index = block.level; index < sectionCounters.length; index++) sectionCounters[index] = 0
    return { ...block, text: `${sectionCounters.slice(0, block.level).join('.')}. ${block.text}` }
  })
  const date       = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const footer = <Text fixed style={{ position: 'absolute', bottom: 24, left: 56, right: 56, textAlign: 'center', fontSize: 9, color: '#64748b' }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />

  const doc = (
    <Document title={title} author="Nyx Agent" creator="Nyx Agent by CTRL Build">
      {template === 'academic' && <Page size="A4" style={[styles.page, { justifyContent: 'center', alignItems: 'center', textAlign: 'center' }]}>
        <Text style={{ fontSize: 26, fontFamily: fontBoldFamily, marginBottom: 24 }}>{title}</Text>
        <Text style={{ fontSize: 13, color: '#475569' }}>Nyx Agent</Text>
        <Text style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>{date}</Text>
        {footer}
      </Page>}
      <Page size="A4" style={styles.page}>
        {template === 'formal' && <View style={{ borderTopWidth: 2, borderTopColor: '#334155', marginBottom: 18 }} />}
        <View style={styles.title}><Text>{title}</Text></View>
        <View style={styles.meta}><Text>Dibuat oleh Nyx Agent · {date}</Text></View>
        <View style={styles.divider} />
        {numberedBlocks.map((block, i) => {
          if (block.kind === 'pageBreak') return <Text key={i} break />
          if (block.kind === 'heading') {
            const headingStyle = block.level === 1 ? styles.heading1 : block.level === 2 ? styles.heading2 : styles.heading3
            return <Text key={i} style={headingStyle}>{block.text}</Text>
          }
          if (block.kind === 'list') return <View key={i}>{block.items?.map((item, itemIndex) => <Text key={itemIndex} style={item.level > 0 ? styles.listItemNested : styles.listItem}>{`${item.ordered ? '1.' : '•'} ${item.text}`}</Text>)}</View>
          if (block.kind === 'table') return <View key={i} style={styles.table}>{block.rows?.map((row, rowIndex) => <View key={rowIndex} style={styles.tableRow}>{row.map((cell, cellIndex) => <Text key={cellIndex} style={[styles.tableCell, rowIndex === 0 ? styles.tableHeader : {}]}>{cell}</Text>)}</View>)}</View>
          return <Text key={i} style={styles.paragraph}>{block.text}</Text>
        })}
        {footer}
      </Page>
    </Document>
  )

  // renderToBuffer expects a React element; cast for TS
  const buf = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0])
  return Buffer.from(buf)
}

// ── DOCX generator ─────────────────────────────────

async function generateDOCX(title: string, content: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } =
    await import('docx')

  const blocks = parseDocumentBlocks(content)
  const date = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  // ── Pre-scan: build numbered-list registry BEFORE flatMap ──
  // Each ordered list block gets a unique stable reference ID based on its
  // position in the blocks array. We register ALL of them upfront so the
  // numbering.config array is always consistent with the paragraph references.
  const numberedListRefs: Map<number, string> = new Map()
  blocks.forEach((block, idx) => {
    if (block.kind === 'list' && block.items?.some(item => item.ordered)) {
      numberedListRefs.set(idx, `nyx-list-${idx}`)
    }
  })

  const borderStyle = {
    top:    { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    left:   { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    right:  { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
  }

  const children = [
    new Paragraph({
      text:    title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text:    `Dibuat oleh Nyx Agent · ${date}`,
          color:   '888888',
          size:    18,
          italics: true,
        }),
      ],
      spacing: { after: 200 },
    }),
    ...blocks.flatMap((block, blockIndex) => {
      if (block.kind === 'pageBreak') {
        return [new Paragraph({ pageBreakBefore: true })]
      }

      if (block.kind === 'heading') {
        const heading = block.level === 1
          ? HeadingLevel.HEADING_1
          : block.level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3
        return [new Paragraph({
          text:    block.text || '',
          heading,
          spacing: { before: block.level === 1 ? 260 : 160, after: 100 },
        })]
      }

      if (block.kind === 'list') {
        const ref = numberedListRefs.get(blockIndex)
        return (block.items || []).map(item => new Paragraph({
          children: [new TextRun({ text: item.text, size: 22 })],
          // Use bullet for unordered; numbering reference for ordered
          bullet:    !item.ordered ? { level: item.level } : undefined,
          numbering: item.ordered && ref ? { reference: ref, level: item.level } : undefined,
          spacing:   { after: 60 },
        }))
      }

      if (block.kind === 'table') {
        const tableRows = block.rows || []
        if (tableRows.length === 0) return []
        const colCount = Math.max(...tableRows.map(r => r.length))
        return [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows.map((row, rowIndex) => {
            // Pad short rows to match column count
            const cells = Array.from({ length: colCount }, (_, ci) => row[ci] ?? '')
            return new TableRow({
              tableHeader: rowIndex === 0,
              children: cells.map(cell => new TableCell({
                borders: borderStyle,
                shading: rowIndex === 0 ? { fill: 'E2E8F0' } : undefined,
                children: [new Paragraph({
                  children: [new TextRun({
                    text: cell,
                    bold: rowIndex === 0,
                    size: 20,
                  })],
                  spacing: { before: 60, after: 60 },
                })],
              })),
            })
          }),
        })]
      }

      // paragraph
      return [new Paragraph({
        children: [new TextRun({ text: block.text || '', size: 22 })],
        spacing:  { after: 120 },
        alignment: AlignmentType.JUSTIFIED,
      })]
    }),
  ]

  const doc = new Document({
    creator: 'Nyx Agent by CTRL Build',
    title,
    // Only register numbering configs for blocks that actually have ordered lists
    numbering: numberedListRefs.size > 0 ? {
      config: Array.from(numberedListRefs.entries()).map(([, ref]) => ({
        reference: ref,
        levels: Array.from({ length: 4 }, (_, level) => ({
          level,
          format:    'decimal' as const,
          text:      `%${level + 1}.`,
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: {
              indent: { left: 720 + level * 360, hanging: 360 },
            },
          },
        })),
      })),
    } : undefined,
    sections: [{ children }],
  })

  return Packer.toBuffer(doc)
}

// ── XLSX generator ─────────────────────────────────

async function generateXLSX(title: string, rows: string[][]): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default

  const wb  = new ExcelJS.Workbook()
  wb.creator = 'Nyx Agent by CTRL Build'
  wb.created  = new Date()

  const ws = wb.addWorksheet(title.slice(0, 31)) // sheet name max 31 chars

  if (rows.length === 0) {
    ws.addRow(['(No data)'])
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
  }

  // First row = header
  const headerRow = ws.addRow(rows[0])
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill  = {
      type:    'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
    }
  })
  headerRow.height = 22

  // Data rows
  for (let i = 1; i < rows.length; i++) {
    const row = ws.addRow(rows[i])
    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = {
          type:    'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        }
      })
    }
  }

  // Auto-width columns (approximate)
  ws.columns.forEach(col => {
    let maxLen = 10
    col.eachCell?.({ includeEmpty: false }, cell => {
      const len = String(cell.value ?? '').length
      if (len > maxLen) maxLen = len
    })
    col.width = Math.min(maxLen + 4, 60)
  })

  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
}

// ── Main handler ───────────────────────────────────

export const runtime    = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  let body: ExportRequest
  try {
    body = (await req.json()) as ExportRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { type, title = 'Dokumen', content = '', rows = [], filename, template = 'auto', font = 'auto', preview = false } = body

  if (!['pdf', 'docx', 'xlsx'].includes(type)) {
    return Response.json({ error: 'type must be pdf, docx, or xlsx' }, { status: 400 })
  }

  const safeFilename = sanitizeFilename(filename || title)

  try {
    if (type === 'pdf') {
      const pdfContent = content.trim() || title
      const buf = await generatePDF(title, pdfContent, template, font)
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type':        'application/pdf',
          'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
          'Content-Length':      String(buf.length),
        },
      })
    }

    if (type === 'docx') {
      const docxContent = content.trim() || title
      if (preview) {
        const html = generatePreviewHTML('docx', title, docxContent, [], template)
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
      const buf = await generateDOCX(title, docxContent)
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safeFilename}.docx"`,
          'Content-Length':      String(buf.length),
        },
      })
    }

    // xlsx — auto-parse markdown table if rows not provided
    if (rows.length === 0 && content.trim()) {
      const tableRows = parseMarkdownTable(content)
      body.rows = tableRows.length > 0 ? tableRows : [['Konten'], [content.slice(0, 200)]]
    }
    const exportRows = (body.rows ?? []).length > 0 ? body.rows! : [['Konten'], [content.slice(0, 200)]]
    if (preview) {
      const html = generatePreviewHTML('xlsx', title, content, exportRows, template)
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    const buf = await generateXLSX(title, exportRows)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safeFilename}.xlsx"`,
        'Content-Length':      String(buf.length),
      },
    })
  } catch (err) {
    console.error('[export] generation error:', err)
    return Response.json(
      { error: 'Failed to generate file. ' + (err instanceof Error ? err.message : String(err)) },
      { status: 500 }
    )
  }
}

// ── Markdown table parser ──────────────────────────

function parseMarkdownTable(text: string): string[][] {
  const lines = text.split('\n').filter(l => l.trim().startsWith('|'))
  const rows: string[][] = []
  for (const line of lines) {
    if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue
    const cells = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

// ── HTML preview generator (DOCX / XLSX only) ─────
// Produces a self-contained HTML page with A4 page simulation.
// CSS is embedded so it works in an <iframe srcDoc> without any
// external stylesheet dependency.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function blockToHtml(block: DocumentBlock, counters: number[], tmpl: Exclude<ExportTemplate, 'auto'>): string | null {
  if (block.kind === 'pageBreak') return null

  if (block.kind === 'heading') {
    let text = escapeHtml(block.text || '')
    if (tmpl === 'formal' && block.level) {
      counters[block.level - 1]++
      for (let i = block.level; i < counters.length; i++) counters[i] = 0
      text = `${counters.slice(0, block.level).join('.')}. ${text}`
    }
    const tag = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3'
    return `<${tag}>${text}</${tag}>`
  }

  if (block.kind === 'list' && block.items?.length) {
    const tag = block.items[0].ordered ? 'ol' : 'ul'
    const items = block.items.map(item => {
      const ind = item.level > 0 ? ` style="margin-left:${item.level * 1.4}rem"` : ''
      return `<li${ind}>${escapeHtml(item.text)}</li>`
    }).join('')
    return `<${tag}>${items}</${tag}>`
  }

  if (block.kind === 'table' && block.rows?.length) {
    const cols = Math.max(...block.rows.map(r => r.length))
    const head = block.rows[0].map(c => `<th>${escapeHtml(c)}</th>`).join('')
    const body = block.rows.slice(1).map((r, i) => {
      const cells = Array.from({ length: cols }, (_, ci) => r[ci] ?? '')
      return `<tr class="${i % 2 === 1 ? 'stripe' : ''}">${cells.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
    }).join('')
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  }

  if (block.text) return `<p${tmpl === 'formal' ? ' class="just"' : ''}>${escapeHtml(block.text)}</p>`
  return null
}

function blocksToHtml(blocks: DocumentBlock[], tmpl: Exclude<ExportTemplate, 'auto'>): string {
  const counters = [0, 0, 0]
  const out: string[] = []

  for (const block of blocks) {
    const html = blockToHtml(block, counters, tmpl)
    if (html) out.push(html)
    else out.push('<hr class="page-break"/>')
  }

  return out.join('\n')
}

function renderPreviewPages(
  blocks: DocumentBlock[],
  tmpl: Exclude<ExportTemplate, 'auto'>,
  title: string,
  date: string,
): string {
  const pageGroups: DocumentBlock[][] = []
  let currentPage: DocumentBlock[] = []

  for (const block of blocks) {
    if (block.kind === 'pageBreak') {
      if (currentPage.length || pageGroups.length === 0) {
        pageGroups.push(currentPage)
      }
      currentPage = []
      continue
    }
    currentPage.push(block)
  }

  if (currentPage.length || pageGroups.length === 0) {
    pageGroups.push(currentPage)
  }

  const counters = [0, 0, 0]
  return pageGroups.map((pageBlocks, pageIndex) => {
    const showHeader = pageIndex === 0
    const headerHtml = showHeader
      ? (tmpl === 'academic'
        ? `<div class="cover"><div class="cover-title">${escapeHtml(title)}</div><div class="cover-meta">Nyx Agent · ${date}</div></div>`
        : `${tmpl === 'formal' ? '<div class="formal-bar"></div>' : ''}
           <h1 class="doc-title">${escapeHtml(title)}</h1>
           <div class="doc-meta">Dibuat oleh Nyx Agent · ${date}</div>
           <hr class="divider" />`)
      : ''

    const bodyHtml = pageBlocks
      .map(block => blockToHtml(block, counters, tmpl))
      .filter((chunk): chunk is string => Boolean(chunk))
      .join('\n')

    return `<div class="page" data-page-break="true" data-page-index="${pageIndex}">${headerHtml}${bodyHtml}</div>`
  }).join('\n')
}

function generatePreviewHTML(
  type: ExportType,
  title: string,
  content: string,
  rows: string[][],
  requestedTemplate: ExportTemplate,
): string {
  const t    = resolveTemplate(requestedTemplate, title, content)
  const date = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  const safe = escapeHtml(title)

  let bodyHtml: string
  if (type === 'xlsx') {
    if (!rows.length) {
      bodyHtml = '<p><em>(No data)</em></p>'
    } else {
      const cols = Math.max(...rows.map(r => r.length))
      const head = rows[0].map(c => `<th>${escapeHtml(c)}</th>`).join('')
      const body = rows.slice(1).map((r, i) => {
        const cells = Array.from({ length: cols }, (_, ci) => r[ci] ?? '')
        return `<tr class="${i % 2 === 1 ? 'stripe' : ''}">${cells.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
      }).join('')
      bodyHtml = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    }
  } else {
    const blocks = parseDocumentBlocks(content || title)
    bodyHtml = renderPreviewPages(blocks, t, title, date)
  }

  const bodyFont  = t === 'academic' ? 'Georgia,"Times New Roman",serif' : '"Segoe UI",Inter,sans-serif'
  const bodySize  = t === 'academic' ? '11pt' : '10.5pt'
  const lineH     = t === 'academic' ? '1.7'  : t === 'formal' ? '1.55' : '1.65'
  const textColor = t === 'formal'   ? '#263238' : '#1a1a1a'
  const thBg      = t === 'academic' ? '#f1f5f9' : '#e2e8f0'
  const divColor  = t === 'formal'   ? '#334155' : '#e0e0e0'
  const docTitleSz = t === 'academic' ? '20pt' : '18pt'

  // A4 at 96 dpi ≈ 794 × 1123 px
  // Strategy: render all content in one natural flow inside a single .page div.
  // The page div has A4 width and auto height — content overflows naturally.
  // CSS break-inside:avoid keeps headings/tables/lists from splitting awkwardly.
  // A background repeating-linear-gradient draws subtle A4 page boundary lines
  // every 1123px so the user gets a visual sense of where pages are without
  // any JS-based splitting that would differ from the DOCX renderer.
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${safe}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}

/* ── Page wrapper ── */
html,body{
  background:#e8eaed;
  font-family:${bodyFont};
  font-size:${bodySize};
  line-height:${lineH};
  color:${textColor};
}
.page-outer{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:0;
  padding:20px 16px 32px;
}
.page{
  position:relative;
  background:#fff;
  width:794px;
  min-height:1123px;
  padding:42px 56px 48px;
  box-shadow:0 2px 10px rgba(0,0,0,.18);
  border:1px solid rgba(148, 163, 184, 0.35);
  border-radius:2px;
  break-inside:avoid;
  page-break-before:always;
  page-break-inside:avoid;
  margin:0 0 28px;
  background-image:linear-gradient(
    to bottom,
    transparent 0,
    transparent 1110px,
    rgba(148, 163, 184, 0.28) 1110px,
    rgba(148, 163, 184, 0.28) 1112px,
    transparent 1112px,
    transparent 1123px
  );
}
.page:first-child{page-break-before:auto}
.page:last-child{margin-bottom:0}
.page + .page{margin-top:0; border-top:1px solid rgba(148,163,184,.45)}

/* ── Cover (academic) ── */
.cover{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:340px;padding-bottom:28px;border-bottom:1px solid #e2e8f0;margin-bottom:24px}
.cover-title{font-size:22pt;font-weight:700;line-height:1.2;margin-bottom:10px}
.cover-meta{font-size:11pt;color:#64748b}

/* ── Doc header ── */
.formal-bar{border-top:2px solid #334155;margin-bottom:12px}
.doc-title{font-size:${docTitleSz};font-weight:700;margin-bottom:6px}
.doc-meta{font-size:9pt;color:#888;margin-bottom:14px}
.divider{border:none;border-top:1px solid ${divColor};margin-bottom:14px}

/* ── Typography ── */
h1{font-size:16pt;font-weight:700;margin:20px 0 8px;break-after:avoid}
h2{font-size:13pt;font-weight:700;margin:14px 0 6px;break-after:avoid}
h3{font-size:11pt;font-weight:700;margin:10px 0 5px;break-after:avoid}
p{margin-bottom:10px}
p.just{text-align:justify}
ul,ol{padding-left:1.4rem;margin-bottom:10px;break-inside:avoid}
li{margin-bottom:4px}

/* ── Manual page break ── */
.page-break{
  border:none;
  border-top:2px dashed #94a3b8;
  margin:32px 0;
  break-before:page;
}

/* ── Table ── */
table{width:100%;border-collapse:collapse;margin:12px 0 16px;font-size:9pt;break-inside:avoid}
th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}
th{background:${thBg};font-weight:700}
tr.stripe td{background:#f8fafc}
</style>
</head>
<body>
<div class="page-outer">
  ${bodyHtml || (t === 'academic' ? `<div class="page"><div class="cover"><div class="cover-title">${safe}</div><div class="cover-meta">Nyx Agent · ${date}</div></div></div>` : `<div class="page"><h1 class="doc-title">${safe}</h1><div class="doc-meta">Dibuat oleh Nyx Agent · ${date}</div></div>`) }
</div>
</body>
</html>`
}