'use client'

/* ═══════════════════════════════════════════════════
   Sidebar — Conversation list, New Chat, Settings
   + inline rename (double-click), delete confirm
═══════════════════════════════════════════════════ */

import { useState, useRef, useEffect } from 'react'
import { Plus, MessageSquare, Trash2, Settings, X, Edit3, MoreHorizontal, Pin, Share2 } from 'lucide-react'
import { groupSessionsByDate, type ChatSession } from '@/lib/storage'
import { cn } from '@/lib/utils'

interface SidebarProps {
  sessions:      ChatSession[]
  activeId:      string | null
  collapsed:     boolean
  onNewChat:     () => void
  onSwitch:      (id: string) => void
  onDelete:      (id: string) => void
  onRename:      (id: string, title: string) => void
  onPin:         (id: string) => void
  onShare:       (session: ChatSession) => void
  onClose:       () => void
  onOpenSettings: () => void
}

export function Sidebar({
  sessions, activeId, collapsed,
  onNewChat, onSwitch, onDelete, onRename, onPin, onShare, onClose, onOpenSettings,
}: SidebarProps) {
  const [deleteSession, setDeleteSession] = useState<ChatSession | null>(null)
  const [renamingId, setRenamingId]       = useState<string | null>(null)
  const [renameValue, setRenameValue]     = useState('')
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const renameInputRef                    = useRef<HTMLInputElement>(null)

  const groups = groupSessionsByDate(sessions)

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  useEffect(() => {
    if (!menuSessionId) return
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-chat-menu]')) setMenuSessionId(null)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [menuSessionId])

  const startRename = (session: ChatSession) => {
    setRenamingId(session.id)
    setRenameValue(session.title)
  }

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim())
    setRenamingId(null)
    setRenameValue('')
  }

  const cancelRename = () => { setRenamingId(null); setRenameValue('') }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
  }

  const handleDelete = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation()
    setMenuSessionId(null)
    setDeleteSession(session)
  }

  return (
    <>
      {/* Backdrop (mobile) */}
      <div
        className={cn(
          'fixed inset-0 z-20 bg-black/50 transition-opacity lg:hidden',
          collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
        onClick={onClose}
      />

      <aside
        className={cn(
          'fixed left-0 top-0 z-30 flex h-full w-[248px] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[transform,width] duration-200 lg:relative lg:z-auto',
          collapsed
            ? '-translate-x-full lg:w-0 lg:-translate-x-full'
            : 'translate-x-0 lg:w-[248px] lg:translate-x-0'
        )}
      >
        {/* Header */}
        <div className="flex h-12 items-center justify-between px-3">
          <button
            onClick={onNewChat}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/nyx-agent/icon-agent-chat.png"
              alt="Nyx Agent"
              width={24}
              height={24}
              className="h-5 w-5 object-contain"
            />
            Nyx Agent
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
            title="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>

        {/* New Chat */}
        <div className="px-3 pt-2">
          <button
            onClick={onNewChat}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
          >
            <Plus size={15} />
            New Chat
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {groups.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No conversations yet
            </p>
          )}

          {groups.map(([label, items]) => (
            <div key={label}>
              <p className="px-3 pb-1.5 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/45 first:pt-1">
                {label}
              </p>
              {items.map(session => (
                <div
                  key={session.id}
                  onClick={() => onSwitch(session.id)}
                  className={cn(
                    'group relative flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors',
                    session.id === activeId
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
                  )}
                >
                  <MessageSquare size={13} className="shrink-0 opacity-50" />

                  {renamingId === session.id ? (
                    <input
                      ref={renameInputRef}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      onBlur={commitRename}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate"
                      onDoubleClick={e => { e.stopPropagation(); startRename(session) }}
                      title="Double-click to rename"
                    >
                      {session.title}
                    </span>
                  )}

                  {renamingId !== session.id && (
                    <div className="relative shrink-0" data-chat-menu>
                      <button
                        onClick={e => { e.stopPropagation(); setMenuSessionId(id => id === session.id ? null : session.id) }}
                        className="rounded p-1 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent-foreground/10 hover:text-sidebar-foreground"
                        title="Chat actions"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {menuSessionId === session.id && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-sidebar-border bg-sidebar py-1 shadow-xl">
                          <button onClick={e => { e.stopPropagation(); onPin(session.id); setMenuSessionId(null) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent">
                            <Pin size={14} className="text-sidebar-foreground/60" />
                            {session.pinned ? 'Unpin chat' : 'Pin chat'}
                          </button>
                          <button onClick={e => { e.stopPropagation(); startRename(session); setMenuSessionId(null) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent">
                            <Edit3 size={14} className="text-sidebar-foreground/60" />
                            Rename
                          </button>
                          <button onClick={e => { e.stopPropagation(); onShare(session); setMenuSessionId(null) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent">
                            <Share2 size={14} className="text-sidebar-foreground/60" />
                            Share chat
                          </button>
                          <div className="my-1 border-t border-sidebar-border" />
                          <button onClick={e => handleDelete(e, session)} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent">
                            <Trash2 size={14} className="text-sidebar-foreground/60" />
                            Delete chat
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Settings size={15} />
            Settings
          </button>
        </div>
      </aside>

      {deleteSession && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDeleteSession(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-chat-title"
          >
            <h2 id="delete-chat-title" className="text-base font-semibold text-foreground">Delete conversation?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              “{deleteSession.title}” will be permanently removed from this device.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteSession(null)} className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={() => { onDelete(deleteSession.id); setDeleteSession(null) }}
                className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90"
              >
                Delete chat
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
