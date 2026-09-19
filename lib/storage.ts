/* ═══════════════════════════════════════════════════
   Nyx Agent — localStorage session management
   Ported from useChatSession.js (Vite project)
═══════════════════════════════════════════════════ */

export const STORAGE_KEYS = {
  SESSIONS: 'nyx-sessions',
  ACTIVE:   'nyx-active',    // sessionStorage — lost on tab close
  SETTINGS: 'nyx-settings',
  CUSTOM_PROVIDERS: 'nyx-custom-providers',
} as const

export interface CustomProviderModel {
  id: string
  label: string
  description?: string
}

export interface CustomProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: CustomProviderModel[]
  directConnection: boolean
}

export function loadCustomProviders(): CustomProvider[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_PROVIDERS)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function saveCustomProviders(providers: CustomProvider[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEYS.CUSTOM_PROVIDERS, JSON.stringify(providers))
}

export interface ChatFile {
  id: string
  name: string
  size: number
  type: 'image' | 'pdf' | 'docx' | 'doc' | 'xlsx' | 'pptx' | 'text'
  dataUrl?: string
  extractedText?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  files?: ChatFile[]
  sources?: SourceItem[]
  failed?: boolean
}

export interface SourceItem {
  index: number
  title: string
  url: string
  domain: string
  favicon?: string
}

export interface ChatSession {
  id: string
  title: string
  pinned?: boolean
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface ChatSettings {
  theme: 'dark' | 'light'
  enterToSend: boolean
  selectedModel: string
  hasSeenWelcome?: boolean
}

export const DEFAULT_SETTINGS: ChatSettings = {
  theme:           'dark',
  enterToSend:     true,
  selectedModel:   'auto',
  hasSeenWelcome:  false,
}

// ── ID generation ──────────────────────────────────

export function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ── Session persistence ────────────────────────────

export function loadSessions(): ChatSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSIONS)
    return raw ? (JSON.parse(raw) as ChatSession[]) : []
  } catch {
    return []
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions))
  } catch (e) {
    console.error('[storage] Failed to save sessions', e)
  }
}

export function loadActiveId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(STORAGE_KEYS.ACTIVE) || null
  } catch {
    return null
  }
}

export function saveActiveId(id: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id) sessionStorage.setItem(STORAGE_KEYS.ACTIVE, id)
    else sessionStorage.removeItem(STORAGE_KEYS.ACTIVE)
  } catch { /* ignore */ }
}

export function loadSettings(): ChatSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS)
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ChatSettings>) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: ChatSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings))
  } catch { /* ignore */ }
}

// ── Auto-title from first user message ─────────────

export function autoTitle(message: string): string {
  const trimmed = message.trim()
  if (trimmed.length <= 40) return trimmed
  return trimmed.slice(0, 40).trim() + '...'
}

// ── Date grouping for sidebar ──────────────────────

export function groupSessionsByDate(sessions: ChatSession[]): [string, ChatSession[]][] {
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yday  = today - 86_400_000
  const week  = today - 7 * 86_400_000

  const groups: Record<string, ChatSession[]> = {
    'Today': [],
    'Yesterday': [],
    'Previous 7 days': [],
    'Earlier': [],
  }

  const sorted = [...sessions].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })

  const pinned = sorted.filter(session => session.pinned)
  if (pinned.length > 0) groups['Pinned'] = pinned

  for (const s of sorted.filter(session => !session.pinned)) {
    if (s.updatedAt >= today)      groups['Today'].push(s)
    else if (s.updatedAt >= yday)  groups['Yesterday'].push(s)
    else if (s.updatedAt >= week)  groups['Previous 7 days'].push(s)
    else                           groups['Earlier'].push(s)
  }

  const entries = Object.entries(groups).filter(([label, items]) => label !== 'Pinned' && items.length > 0)
  return pinned.length > 0 ? [['Pinned', pinned], ...entries] : entries
}
