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
const fontUrlCache = new Map<string, string>()
const registeredFonts = new Set<string>()

interface ExportRequest {
  type:      ExportType
  title?:    string
  content?:  string
  rows?:     string[][]
  filename?: string
  template?: ExportTemplate
  font?: ExportFont
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

function parseDocumentBlocks(text: string): DocumentBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: DocumentBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) { index++; continue }

    if (/^(?:---|\*\s*\*\s*\*)$/.test(line)) {
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

async function getGoogleFontUrl(family: string, weight = '400'): Promise<string> {
  const cacheKey = `${family}:${weight}`
  const cachedUrl = fontUrlCache.get(cacheKey)
  if (cachedUrl) return cachedUrl

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const familyParam = encodeURIComponent(family).replace(/%20/g, '+')
    const response = await fetch(`https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weight}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NyxAgent/1.0)' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Google Fonts returned ${response.status}`)
    const css = await response.text()
    const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)
    if (!match?.[1]) throw new Error('Font URL not found')
    fontUrlCache.set(cacheKey, match[1])
    return match[1]
  } finally {
    clearTimeout(timeout)
  }
}

async function registerGoogleFont(Font: { register: (options: { family: string; src: string }) => void }, family: string): Promise<string> {
  if (registeredFonts.has(family)) return family
  try {
    const fontUrl = await getGoogleFontUrl(family)
    Font.register({ family, src: fontUrl })
    registeredFonts.add(family)
    return family
  } catch (error) {
    console.warn(`[export] unable to load font "${family}", using Helvetica`, error)
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
  const fontFamily = await registerGoogleFont(Font, requestedFamily)
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
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } =
    await import('docx')

  const blocks = parseDocumentBlocks(content)
  const date       = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  const children = [
    new Paragraph({
      text:    title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text:   `Dibuat oleh Nyx Agent · ${date}`,
          color:  '888888',
          size:   18,
          italics: true,
        }),
      ],
      spacing: { after: 200 },
    }),
    ...blocks.flatMap((block, blockIndex) => {
      if (block.kind === 'pageBreak') return [new Paragraph({ pageBreakBefore: true })]
      if (block.kind === 'heading') {
        const heading = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
        return [new Paragraph({ text: block.text || '', heading, spacing: { before: block.level === 1 ? 260 : 160, after: 100 } })]
      }
      if (block.kind === 'list') {
        return (block.items || []).map(item => new Paragraph({
          text: item.text,
          bullet: item.ordered ? undefined : { level: item.level },
          numbering: item.ordered ? { reference: `nyx-numbered-${blockIndex}`, level: item.level } : undefined,
          indent: { left: 720 + item.level * 360, hanging: 360 },
          spacing: { after: 60 },
        }))
      }
      if (block.kind === 'table') {
        return [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: (block.rows || []).map((row, rowIndex) => new TableRow({
            children: row.map(cell => new TableCell({
              children: [new Paragraph({
                children: [new TextRun({ text: cell, bold: rowIndex === 0, size: 20 })],
              })],
              shading: rowIndex === 0 ? { fill: 'E2E8F0' } : undefined,
            })),
          })),
        })]
      }
      return [new Paragraph({
        children: [new TextRun({ text: block.text || '', size: 22 })],
        spacing: { after: 120 },
        alignment: AlignmentType.JUSTIFIED,
      })]
    }),
  ]

  const doc = new Document({
    creator:  'Nyx Agent by CTRL Build',
    title,
    numbering: {
      config: blocks
        .filter(block => block.kind === 'list' && block.items?.some(item => item.ordered))
        .map((_, index) => ({
          reference: `nyx-numbered-${index}`,
          levels: Array.from({ length: 4 }, (_, level) => ({
            level,
            format: 'decimal' as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        })),
    },
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

  const { type, title = 'Dokumen', content = '', rows = [], filename, template = 'auto', font = 'auto' } = body

  if (!['pdf', 'docx', 'xlsx'].includes(type)) {
    return Response.json({ error: 'type must be pdf, docx, or xlsx' }, { status: 400 })
  }

  const safeFilename = sanitizeFilename(filename || title)

  try {
    if (type === 'pdf') {
      if (!content.trim()) {
        return Response.json({ error: 'content is required for PDF export' }, { status: 400 })
      }
      const buf = await generatePDF(title, content, template, font)
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type':        'application/pdf',
          'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
          'Content-Length':      String(buf.length),
        },
      })
    }

    if (type === 'docx') {
      if (!content.trim()) {
        return Response.json({ error: 'content is required for DOCX export' }, { status: 400 })
      }
      const buf = await generateDOCX(title, content)
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safeFilename}.docx"`,
          'Content-Length':      String(buf.length),
        },
      })
    }

    // xlsx
    if (rows.length === 0 && content.trim()) {
      // Auto-parse markdown table from content if rows not provided
      const tableRows = parseMarkdownTable(content)
      body.rows = tableRows.length > 0 ? tableRows : [['Konten'], [content.slice(0, 200)]]
    }
    const buf = await generateXLSX(title, body.rows!.length > 0 ? body.rows! : [['Konten'], [content.slice(0, 200)]])
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
    // Skip separator rows like |---|---|
    if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue
    const cells = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}
