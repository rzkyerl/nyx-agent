/* ═══════════════════════════════════════════════════
   Nyx Agent — File processing utilities (client-side)
   Ported from constants.js in the Vite project
═══════════════════════════════════════════════════ */

import type { ChatFile } from './storage'
import { genId } from './storage'

export const FILE_CONFIG = {
  maxFiles:     5,
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB per file
  accept:       'image/*,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.rb,.php,.sql,.yaml,.yml,.toml,.ini,.sh,.bat',
}

const MAX_EXTRACTED_CHARS = 50_000

export type FileType = ChatFile['type']

export function getFileType(file: File): FileType {
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()

  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.docx') || mime.includes('wordprocessingml')) return 'docx'
  if (name.endsWith('.doc') || mime === 'application/msword') return 'doc'
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime === 'application/vnd.ms-excel') return 'xlsx'
  if (name.endsWith('.pptx') || name.endsWith('.ppt') || mime.includes('presentation') || mime === 'application/vnd.ms-powerpoint') return 'pptx'
  return 'text'
}

export function getFileIcon(fileType: FileType): string {
  switch (fileType) {
    case 'image': return '📎'
    case 'pdf':   return '📑'
    case 'docx':
    case 'doc':   return '📄'
    case 'xlsx':  return '📊'
    case 'pptx':  return '📊'
    default:      return '📄'
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function truncateExtracted(text: string): string {
  if (!text || text.length <= MAX_EXTRACTED_CHARS) return text
  return text.slice(0, MAX_EXTRACTED_CHARS) + '\n\n[... file truncated ...]'
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

async function extractPdfText(file: File): Promise<string> {
  // Dynamic import — keeps bundle small, only loaded when needed
  const [pdfjs, workerMod] = await Promise.all([
    import('pdfjs-dist'),
    // @ts-expect-error — worker URL import
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf  = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text    = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) pages.push(text)
  }

  const result = pages.join('\n\n').trim()
  if (!result) throw new Error('PDF contained no extractable text')
  return result
}

async function extractDocxText(file: File): Promise<string> {
  const mammothMod = await import('mammoth')
  const mammoth    = (mammothMod.default ?? mammothMod) as typeof import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result      = await mammoth.extractRawText({ arrayBuffer })
  const text        = (result.value || '').trim()
  if (!text) throw new Error('DOCX contained no extractable text')
  return text
}

export async function processFile(file: File): Promise<ChatFile> {
  const fileType = getFileType(file)
  const base: ChatFile = {
    id:   genId('file'),
    name: file.name,
    size: file.size,
    type: fileType,
  }

  try {
    switch (fileType) {
      case 'image':
        base.dataUrl = await readImageAsDataUrl(file)
        break
      case 'pdf':
        base.extractedText = truncateExtracted(await extractPdfText(file))
        break
      case 'docx':
        base.extractedText = truncateExtracted(await extractDocxText(file))
        break
      case 'doc':
        base.extractedText = `[Could not extract text from "${file.name}" — .doc (legacy Word) is not supported. Save as .docx or paste the text.]`
        break
      case 'xlsx':
        base.extractedText = `[File Excel: ${file.name} — konten tidak bisa diekstrak. Salin teks secara manual.]`
        break
      case 'pptx':
        base.extractedText = `[File PowerPoint: ${file.name} — konten tidak bisa diekstrak. Salin teks secara manual.]`
        break
      default:
        base.extractedText = truncateExtracted(await readTextFile(file))
        break
    }
  } catch {
    base.extractedText = `[Could not read file content: ${file.name}]`
  }

  return base
}

/**
 * Build message content array for the API (multipart messages with files)
 */
export function buildMessageContent(
  text: string,
  files?: ChatFile[]
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (!files || files.length === 0) return text

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = []

  if (text) content.push({ type: 'text', text })

  for (const file of files) {
    if (file.type === 'image' && file.dataUrl) {
      content.push({ type: 'image_url', image_url: { url: file.dataUrl } })
    } else if (file.type !== 'image') {
      if (file.extractedText && !file.extractedText.startsWith('[Could not')) {
        content.push({
          type: 'text',
          text: `--- File: ${file.name} ---\n\n${file.extractedText}\n\n--- End of ${file.name} ---`,
        })
      } else {
        content.push({
          type: 'text',
          text: `[Attached file: ${file.name} (${file.size} bytes) — content could not be extracted]`,
        })
      }
    }
  }

  return content
}

export const SUGGESTIONS = [
  { label: 'Analyze a document',  prompt: 'Can you help me analyze a document?' },
  { label: 'Write something',      prompt: 'Help me write something' },
  { label: 'Explain a concept',    prompt: 'Can you explain a concept to me?' },
  { label: 'Help me code',         prompt: 'Help me with some code' },
]
