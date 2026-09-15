'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
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
        className="w-full max-w-md rounded-t-2xl border border-border bg-background p-6 shadow-xl sm:rounded-2xl"
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

          {/* Data */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Data</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Conversations are stored in your browser localStorage. They persist across refreshes but are private to this device.
            </p>
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <span className="text-sm text-destructive">
                {confirmClear ? 'Click again to confirm delete' : 'Clear all conversations'}
              </span>
              <button
                onClick={() => {
                  if (confirmClear) { onClearAll(); setConfirmClear(false); onClose() }
                  else setConfirmClear(true)
                }}
                className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90 transition-opacity"
              >
                Clear
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
