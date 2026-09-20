'use client'

import { useState } from 'react'
import { Mail, X } from 'lucide-react'
import { NIM_MODELS } from '@/lib/models'
import type { ChatSettings } from '@/lib/storage'
import { cn } from '@/lib/utils'

interface SettingsPanelProps {
  settings:  ChatSettings
  onClose:   () => void
  onUpdate:  (patch: Partial<ChatSettings>) => void
  onClearAll: () => void
}

export function SettingsPanel({ settings, onClose, onUpdate, onClearAll }: SettingsPanelProps) {
  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-background p-6 shadow-xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Appearance */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Appearance</p>
            <div className="flex items-center justify-between">
              <span className="text-sm">Theme</span>
              <div className="flex gap-1">
                {(['light', 'dark'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => onUpdate({ theme: t })}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                      settings.theme === t ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Chat */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chat</p>
            <div className="flex items-center justify-between">
              <span className="text-sm">Press Enter to send</span>
              <button
                onClick={() => onUpdate({ enterToSend: !settings.enterToSend })}
                className={cn(
                  'relative h-5 w-9 rounded-full transition-colors',
                  settings.enterToSend ? 'bg-foreground' : 'bg-muted'
                )}
                role="switch"
                aria-checked={settings.enterToSend}
              >
                <span
                  className={cn(
                    'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
                    settings.enterToSend ? 'translate-x-4' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
          </section>

          {/* AI */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI</p>
            <p className="text-sm text-muted-foreground">
              Default model: <span className="text-foreground">{NIM_MODELS.find(m => m.id === (settings.selectedModel || 'auto'))?.label || 'Auto'}</span>
            </p>
          </section>

          {/* Memory */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Memory</p>
              <button
                onClick={() => onUpdate({ memoryEnabled: !settings.memoryEnabled })}
                className={cn('relative h-5 w-9 rounded-full transition-colors', settings.memoryEnabled ? 'bg-foreground' : 'bg-muted')}
                role="switch"
                aria-checked={settings.memoryEnabled}
                aria-label="Enable memory"
              >
                <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform', settings.memoryEnabled ? 'translate-x-4' : 'translate-x-0')} />
              </button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Nyx Agent automatically learns facts and preferences about you from your conversations and uses them in future chats. Stored on this device only.
            </p>
            {settings.memoryEnabled && (
              <>
                <textarea
                  value={settings.memory}
                  onChange={event => onUpdate({ memory: event.target.value })}
                  placeholder="Memory will appear here after a few conversations. You can also write facts manually, e.g. &quot;I prefer concise answers and work with TypeScript.&quot;"
                  rows={4}
                  className="w-full resize-y rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
                />
                {settings.memory.trim() && (
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">Edits here are saved immediately.</p>
                    <button
                      onClick={() => onUpdate({ memory: '' })}
                      className="text-[11px] text-destructive/70 transition-colors hover:text-destructive"
                    >
                      Clear memory
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Data */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Data</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Conversations are stored in your browser localStorage. They persist across refreshes but are private to this device.
            </p>
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <span className="text-sm text-destructive">Clear all conversations</span>
              <button
                onClick={() => setConfirmClear(true)}
                className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90 transition-opacity"
              >
                Clear
              </button>
            </div>
          </section>

          {/* Bug reports */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Report a Bug</p>
            <p className="mb-3 text-sm text-muted-foreground">
              If you find a bug, help us improve Nyx Agent through one of the channels below.
            </p>
            <div className="space-y-1.5">
              <ReportLink href="https://github.com/rzkyerl/nyx-agent/issues" icon={<GitHubIcon />} label="GitHub Issues" />
              <ReportLink href="mailto:ctrlbuild2023@gmail.com" icon={<Mail size={15} />} label="Email" detail="ctrlbuild2023@gmail.com" />
              <ReportLink href="https://www.instagram.com/ctrlbuild_" icon={<InstagramIcon />} label="Instagram" />
            </div>
          </section>
        </div>
      </div>

      {confirmClear && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmClear(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-conversations-title"
          >
            <h2 id="clear-conversations-title" className="text-base font-semibold text-foreground">Clear all conversations?</h2>
            <p className="mt-2 text-sm text-muted-foreground">All conversations stored on this device will be permanently removed.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmClear(false)} className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
              <button onClick={() => { onClearAll(); setConfirmClear(false); onClose() }} className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90">Clear conversations</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.84 1.23 1.84 1.23 1.07 1.83 2.8 1.3 3.49.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.6-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r=".75" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ReportLink({ href, icon, label, detail }: { href: string; icon: React.ReactNode; label: string; detail?: string }) {
  return (
    <a
      href={href}
      target={href.startsWith('mailto:') ? undefined : '_blank'}
      rel={href.startsWith('mailto:') ? undefined : 'noreferrer'}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{label}{detail ? `: ${detail}` : ''}</span>
    </a>
  )
}
