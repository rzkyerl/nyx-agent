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

interface ExportRequest {
  type:      ExportType
  title?:    string
  content?:  string
  rows?:     string[][]
  filename?: string
}

// ── Helpers ────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim().slice(0, 80) || 'export'
}

interface DocumentBlock {
  kind: 'heading' | 'paragraph' | 'list' | 'table'
  text?: string
  items?: string[]
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
      const items: string[] = []
      while (index < lines.length) {
        const item = lines[index].trim().match(/^(?:[-*]|\d+\.)\s+(.+)$/)
        if (!item) break
        items.push(cleanMarkdown(item[1])); index++
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const paragraph: string[] = [line]
    index++
    while (index < lines.length && lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index].trim()) &&
      !lines[index].trim().startsWith('|') &&
      !/^(?:[-*]|\d+\.)\s+/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim()); index++
    }
    blocks.push({ kind: 'paragraph', text: cleanMarkdown(paragraph.join(' ')) })
  }
  return blocks
}

function splitParagraphs(text: string): string[] {
  return parseDocumentBlocks(text).flatMap(block => {
    if (block.kind === 'table') return (block.rows || []).map(row => row.join(' | '))
    if (block.kind === 'list') return block.items || []
    return block.text ? [block.text] : []
  })
}

// ── PDF generator ──────────────────────────────────

async function generatePDF(title: string, content: string): Promise<Buffer> {
  // Dynamic import — @react-pdf/renderer is heavy, only load when needed
  const { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } =
    await import('@react-pdf/renderer')

  Font.registerHyphenationCallback(word => [word])

  const styles = StyleSheet.create({
    page: {
      paddingTop:    48,
      paddingBottom: 48,
      paddingLeft:   56,
      paddingRight:  56,
      fontFamily:    'Helvetica',
      fontSize:      11,
      lineHeight:    1.6,
      color:         '#1a1a1a',
    },
    title: {
      fontSize:     20,
      fontFamily:   'Helvetica-Bold',
      marginBottom: 6,
      color:        '#111111',
    },
    divider: {
      borderBottomWidth: 1,
      borderBottomColor: '#e0e0e0',
      marginBottom:      16,
    },
    paragraph: {
      marginBottom: 10,
    },
    heading: {
      fontFamily: 'Helvetica-Bold',
      fontSize: 14,
      marginTop: 10,
      marginBottom: 6,
    },
    listItem: {
      marginBottom: 5,
      paddingLeft: 10,
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
      backgroundColor: '#e2e8f0',
      fontFamily: 'Helvetica-Bold',
    },
    meta: {
      fontSize:     9,
      color:        '#888888',
      marginBottom: 24,
    },
  })

  const blocks = parseDocumentBlocks(content)
  const date       = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  const doc = (
    <Document title={title} author="Nyx Agent" creator="Nyx Agent by CTRL Build">
      <Page size="A4" style={styles.page}>
        <View style={styles.title}><Text>{title}</Text></View>
        <View style={styles.meta}><Text>Dibuat oleh Nyx Agent · {date}</Text></View>
        <View style={styles.divider} />
        {blocks.map((block, i) => {
          if (block.kind === 'heading') return <Text key={i} style={styles.heading}>{block.text}</Text>
          if (block.kind === 'list') return <View key={i}>{block.items?.map((item, itemIndex) => <Text key={itemIndex} style={styles.listItem}>• {item}</Text>)}</View>
          if (block.kind === 'table') return <View key={i} style={styles.table}>{block.rows?.map((row, rowIndex) => <View key={rowIndex} style={styles.tableRow}>{row.map((cell, cellIndex) => <Text key={cellIndex} style={[styles.tableCell, rowIndex === 0 ? styles.tableHeader : {}]}>{cell}</Text>)}</View>)}</View>
          return <Text key={i} style={styles.paragraph}>{block.text}</Text>
        })}
      </Page>
    </Document>
  )

  // renderToBuffer expects a React element; cast for TS
  const buf = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0])
  return Buffer.from(buf)
}

// ── DOCX generator ─────────────────────────────────

async function generateDOCX(title: string, content: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
    await import('docx')

  const paragraphs = splitParagraphs(content)
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
    ...paragraphs.map(
      p =>
        new Paragraph({
          children: [new TextRun({ text: p, size: 22 })],
          spacing:  { after: 120 },
          alignment: AlignmentType.JUSTIFIED,
        })
    ),
  ]

  const doc = new Document({
    creator:  'Nyx Agent by CTRL Build',
    title,
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

  const { type, title = 'Dokumen', content = '', rows = [], filename } = body

  if (!['pdf', 'docx', 'xlsx'].includes(type)) {
    return Response.json({ error: 'type must be pdf, docx, or xlsx' }, { status: 400 })
  }

  const safeFilename = sanitizeFilename(filename || title)

  try {
    if (type === 'pdf') {
      if (!content.trim()) {
        return Response.json({ error: 'content is required for PDF export' }, { status: 400 })
      }
      const buf = await generatePDF(title, content)
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
