'use client'

/* ═══════════════════════════════════════════════════
   WelcomeModal — ditampilkan sekali saat pertama kali
   user membuka Nyx Agent.
   Fitur: logo, daftar fitur, panduan Local Provider
   (Ollama via Tailscale/ngrok), checkbox "don't show
   again", dan tombol close/get started.
═══════════════════════════════════════════════════ */

import { useState } from 'react'
import Image from 'next/image'
import {
  X, Sparkles, Search, FileText, Download,
  Cpu, History, Zap, Network, MessageSquare,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface WelcomeModalProps {
  onClose: (dontShowAgain: boolean) => void
}

const FEATURES = [
  {
    icon:  <Sparkles size={16} className="text-violet-400" />,
    title: 'Multi-Provider AI',
    desc:  'Auto-fallback across NIM, Groq, and Gemini. Always picks the best available model.',
  },
  {
    icon:  <Search size={16} className="text-blue-400" />,
    title: 'Automatic Web Search',
    desc:  'Detects queries that need up-to-date info and fetches results from the web with inline citations.',
  },
  {
    icon:  <FileText size={16} className="text-emerald-400" />,
    title: 'File Upload and Analysis',
    desc:  'PDF, Word, Excel, PowerPoint, images, and plain text are processed directly in chat.',
  },
  {
    icon:  <Zap size={16} className="text-yellow-400" />,
    title: 'Streaming and Markdown',
    desc:  'Responses stream in real-time with full Markdown rendering, tables, and syntax highlighting.',
  },
  {
    icon:  <Download size={16} className="text-pink-400" />,
    title: 'Document Generation',
    desc:  'Export any assistant response as a PDF, Word (.docx), or Excel (.xlsx) file.',
  },
  {
    icon:  <Cpu size={16} className="text-orange-400" />,
    title: 'Custom and Local Providers',
    desc:  'Connect any OpenAI-compatible endpoint: LM Studio, vLLM, Ollama, OpenRouter, and more.',
  },
  {
    icon:  <History size={16} className="text-cyan-400" />,
    title: 'Persistent Chat History',
    desc:  'Sessions are saved in your browser with support for pinning, renaming, and deleting.',
  },
]

export function WelcomeModal({ onClose }: WelcomeModalProps) {
  const [dontShow, setDontShow] = useState(false)
  const [tab, setTab]           = useState<'features' | 'local'>('features')

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(dontShow) }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      {/* panel */}
      <div className="relative flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">

        {/* close button */}
        <button
          onClick={() => onClose(dontShow)}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        {/* header */}
        <div className="flex flex-col items-center gap-3 px-6 pb-4 pt-8">
          <Image
            src="/images/nyx-agent/logo-agent-chat.png"
            alt="Nyx Agent"
            width={64}
            height={64}
            className="rounded-xl"
            priority
          />
          <div className="text-center">
            <h2 id="welcome-title" className="text-xl font-semibold tracking-tight">
              Welcome to Nyx Agent
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open-source AI assistant powered by multi-provider LLMs
            </p>
          </div>
        </div>

        {/* tab switcher */}
        <div className="flex shrink-0 gap-1 border-b border-border px-6">
          <TabBtn active={tab === 'features'} onClick={() => setTab('features')}>
            <MessageSquare size={13} />
            Features
          </TabBtn>
          <TabBtn active={tab === 'local'} onClick={() => setTab('local')}>
            <Network size={13} />
            Local Provider
          </TabBtn>
        </div>

        {/* scrollable content */}
        <div className="welcome-modal-scrollbar flex-1 overflow-y-auto px-6 py-4">
          {tab === 'features' && <FeaturesTab />}
          {tab === 'local'    && <LocalProviderTab />}
        </div>

        {/* footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-4">
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-primary"
            />
            Don't show again
          </label>
          <Button size="sm" onClick={() => onClose(dontShow)}>
            Get Started
          </Button>
        </div>
      </div>
    </div>
  )
}

/* tab button */
function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

/* tab: features */
function FeaturesTab() {
  return (
    <ul className="grid gap-3">
      {FEATURES.map((f) => (
        <li key={f.title} className="flex gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
          <span className="mt-0.5 shrink-0">{f.icon}</span>
          <div>
            <p className="text-sm font-medium leading-snug">{f.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* tab: local provider */
function LocalProviderTab() {
  return (
    <div className="space-y-5 text-sm">
      {/* intro */}
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-muted-foreground leading-relaxed">
        Nyx Agent supports local models like{' '}
        <strong className="text-foreground">Ollama</strong> and any{' '}
        <strong className="text-foreground">OpenAI-compatible</strong> endpoint (LM Studio, vLLM,
        llama.cpp server). Since the app runs in the browser, your local server needs to be
        reachable via HTTPS or a public tunnel.
      </div>

      {/* step 1 */}
      <Section number={1} title="Start Ollama or your local server">
        <p className="text-muted-foreground">Make sure Ollama is running on your machine:</p>
        <CodeBlock>ollama serve</CodeBlock>
        <p className="text-muted-foreground">
          It runs on{' '}
          <code className="rounded bg-muted px-1 py-0.5">http://localhost:11434</code> by default.
          Pull a model first if you haven't already:
        </p>
        <CodeBlock>{'ollama pull llama3.1:8b\nollama pull qwen2.5:7b'}</CodeBlock>
      </Section>

      {/* step 2 */}
      <Section number={2} title="Expose it via Tailscale Funnel (recommended)">
        <p className="text-muted-foreground">
          <strong className="text-foreground">Tailscale Funnel</strong> exposes a local port to the
          internet over HTTPS with no firewall or router configuration needed.
        </p>
        <CodeBlock>{'# Install Tailscale if you haven\'t\n# https://tailscale.com/download\n\n# Expose the Ollama port\ntailscale funnel 11434'}</CodeBlock>
        <p className="text-muted-foreground">
          Tailscale gives you a URL like{' '}
          <code className="rounded bg-muted px-1 py-0.5">https://your-machine.tail1234.ts.net</code>.
          Copy it as your Base URL.
        </p>
      </Section>

      {/* step 3 */}
      <Section number={3} title="Other tunnel options">
        <div className="space-y-3 text-muted-foreground">
          <AltRow label="ngrok">
            <CodeBlock>ngrok http 11434</CodeBlock>
          </AltRow>
          <AltRow label="Cloudflare Tunnel">
            <CodeBlock>cloudflared tunnel --url http://localhost:11434</CodeBlock>
          </AltRow>
          <AltRow label="Google Colab">
            <p>
              Run Ollama in Colab (free GPU), then expose the port using{' '}
              <code className="rounded bg-muted px-1 py-0.5">cloudflared</code> or{' '}
              <code className="rounded bg-muted px-1 py-0.5">ngrok</code> inside the notebook.
            </p>
          </AltRow>
        </div>
      </Section>

      {/* step 4 */}
      <Section number={4} title="Add it as a Custom Provider in Nyx Agent">
        <ol className="list-decimal space-y-1.5 pl-4 text-muted-foreground">
          <li>
            Open <strong className="text-foreground">Settings</strong> and go to the{' '}
            <strong className="text-foreground">Custom Providers</strong> tab.
          </li>
          <li>
            Click <strong className="text-foreground">Add Provider</strong>.
          </li>
          <li>
            Set <strong className="text-foreground">Base URL</strong> to your tunnel URL,
            e.g. <code className="rounded bg-muted px-1 py-0.5">https://your-machine.ts.net</code>.
          </li>
          <li>API Key can be left empty for Ollama, or fill in any text if required.</li>
          <li>
            Click <strong className="text-foreground">Validate &amp; Save</strong> and detected
            models will appear automatically.
          </li>
          <li>Select the model from the model dropdown in the composer.</li>
        </ol>
      </Section>

      {/* tips */}
      <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>
          <strong>Security tip:</strong> Use Tailscale ACLs or ngrok authentication so your local
          endpoint is not publicly accessible without access control.
        </span>
      </div>
    </div>
  )
}

function Section({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 font-medium">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {number}
        </span>
        {title}
      </h3>
      <div className="space-y-2 pl-7">{children}</div>
    </div>
  )
}

function AltRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-medium text-foreground">{label}</p>
      {children}
    </div>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="welcome-modal-scrollbar overflow-x-auto rounded-lg bg-muted px-3.5 py-2.5 text-xs font-mono text-foreground leading-relaxed">
      <code>{children}</code>
    </pre>
  )
}
