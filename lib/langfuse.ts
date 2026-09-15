/* ═══════════════════════════════════════════════════
   Langfuse — Observability client (langfuse v3 SDK)

   Best-practice instrumentation for NyxAgent:
   • One trace per chat turn (sessionId ties multi-turn convos)
   • One span per provider attempt (search, model fallback loop)
   • Generations carry model, modelParameters, input, output, usageDetails
   • environment tag separates production from dev/preview traces
   • flushAsync() on every serverless exit to avoid data loss
═══════════════════════════════════════════════════ */

import { Langfuse, type LangfuseTraceClient, type LangfuseSpanClient, type LangfuseGenerationClient } from 'langfuse'

// ── Singleton client ────────────────────────────────

let _client: Langfuse | null = null

export function getLangfuse(): Langfuse | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY

  if (!publicKey || !secretKey) {
    // Observability is opt-in — fail silently when not configured
    return null
  }

  if (!_client) {
    _client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
      // Flush immediately — serverless functions have no persistent process
      flushAt: 1,
      flushInterval: 0,
    })
  }

  return _client
}

/**
 * Flush all pending events to Langfuse.
 * Always call this before the serverless function returns.
 */
export async function flushLangfuse(): Promise<void> {
  await getLangfuse()?.flushAsync().catch(() => {})
}

// ── Environment helpers ─────────────────────────────

/** Maps NODE_ENV to a Langfuse environment tag. */
function resolveEnvironment(): string {
  const env = process.env.NODE_ENV
  if (env === 'production') return 'production'
  if (env === 'test') return 'test'
  return 'development'
}

// ── Trace options ───────────────────────────────────

export interface ChatTraceOptions {
  /** Chat session ID — groups all turns of one conversation */
  sessionId?: string
  /** End-user identifier — enables per-user cost/quality views */
  userId?: string
  /** The user's message text used as trace-level input */
  userInput: string
  /** Release/version of the app (optional, e.g. git SHA or semver) */
  release?: string
}

// ── Chat trace ──────────────────────────────────────

/**
 * Create a root trace for a single chat turn.
 *
 * Trace scope follows best practices:
 *   one trace = one user turn (search + model call combined)
 *
 * Returns the trace client, or null when Langfuse is not configured.
 */
export function createChatTrace(opts: ChatTraceOptions): LangfuseTraceClient | null {
  const lf = getLangfuse()
  if (!lf) return null

  return lf.trace({
    name:        'chat-turn',
    sessionId:   opts.sessionId,
    userId:      opts.userId,
    // Trace-level input = the user's message. Evaluators and
    // the tracing table use this at a glance (best-practice).
    input:       opts.userInput,
    environment: resolveEnvironment(),
    release:     opts.release ?? process.env.npm_package_version,
    tags:        ['chat'],
  })
}

// ── Search span ─────────────────────────────────────

/**
 * Span wrapping the web-search pre-phase.
 * Nested under the chat trace; sibling of the model generation(s).
 */
export function createSearchSpan(
  trace: LangfuseTraceClient,
  query: string,
): LangfuseSpanClient {
  return trace.span({
    name:        'web-search',
    input:       { query },
    metadata:    { step: 'pre-search' },
    environment: resolveEnvironment(),
    startTime:   new Date(),
  })
}

// ── Model generation ────────────────────────────────

export interface GenerationOptions {
  model:       string
  provider:    string
  messages:    Array<{ role: string; content: unknown }>
  /** attempt index within the fallback loop (0-based) */
  attemptIndex: number
}

/**
 * Generation observation nested under the chat trace.
 * Each provider attempt in the fallback loop gets its own generation
 * so you can compare latency and cost per attempt in the Langfuse UI.
 */
export function createGeneration(
  trace: LangfuseTraceClient,
  opts: GenerationOptions,
): LangfuseGenerationClient {
  return trace.generation({
    // Name after the action, not the model (stable across model swaps)
    name:       'llm-response',
    model:      opts.model,
    modelParameters: {
      provider:     opts.provider,
      attemptIndex: String(opts.attemptIndex),
    },
    // Full message array as input — gives full context for eval
    input:      opts.messages,
    startTime:  new Date(),
    environment: resolveEnvironment(),
    metadata:   {
      provider:     opts.provider,
      attemptIndex: opts.attemptIndex,
    },
  })
}

// ── Finish helpers ──────────────────────────────────

/**
 * Mark a generation successful.
 * Pass parsed token counts when available for cost tracking.
 */
export function endGenerationSuccess(
  generation: LangfuseGenerationClient,
  output: string,
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
): void {
  generation.end({
    output,
    ...(usage && {
      usageDetails: {
        input:  usage.inputTokens  ?? 0,
        output: usage.outputTokens ?? 0,
        total:  usage.totalTokens  ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      },
    }),
  })
}

/** Mark a generation failed with an error message. */
export function endGenerationError(
  generation: LangfuseGenerationClient,
  errorMessage: string,
): void {
  generation.end({
    output:        errorMessage,
    level:         'ERROR',
    statusMessage: errorMessage,
  })
}

/**
 * Set the trace-level output once the final assistant reply is known.
 * The tracing table and evaluators read this field.
 */
export function updateTraceOutput(
  trace: LangfuseTraceClient,
  output: string,
): void {
  trace.update({ output })
}
