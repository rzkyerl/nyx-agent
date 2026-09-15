# Contributing to Nyx Agent

Thank you for your interest in contributing! This document covers everything you need to get up and running.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Convention](#commit-convention)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Project Structure](#project-structure)
- [Adding a New LLM Provider](#adding-a-new-llm-provider)

---

## Code of Conduct

Be respectful and constructive. We welcome contributors of all experience levels. Harassment or exclusionary behavior of any kind will not be tolerated.

---

## Getting Started

1. **Fork** the repo on GitHub, then clone your fork:
   ```bash
   git clone https://github.com/<your-username>/nyx-agent.git
   cd nyx-agent
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Fill in at least one provider API key
   ```

4. **Start the dev server:**
   ```bash
   pnpm dev
   ```

---

## Development Workflow

- Always branch off `main`:
  ```bash
  git checkout -b feature/my-feature
  # or
  git checkout -b fix/bug-description
  ```
- Run checks before pushing:
  ```bash
  pnpm lint       # ESLint
  pnpm typecheck  # TypeScript
  pnpm format     # Prettier (auto-fix)
  ```
- Keep changes focused — one feature or fix per PR.

---

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `style:` | Formatting, no logic change |
| `refactor:` | Code restructure without behavior change |
| `perf:` | Performance improvement |
| `chore:` | Build, deps, config updates |

Examples:
```
feat: add Anthropic Claude provider
fix: prevent duplicate sources in sidebar
docs: update contributing guide
```

---

## Pull Request Guidelines

- Target the `main` branch.
- Fill out the PR description: what changed, why, and how to test it.
- Keep PRs small and focused — easier to review, faster to merge.
- Link any related issue with `Closes #123`.
- Ensure all lint and typecheck pass before requesting review.

---

## Project Structure

```
app/
  api/
    chat/       ← Main streaming endpoint
    search/     ← Web search (LangSearch / Serper)
    title/      ← AI-generated session title
    export/     ← PDF / DOCX / XLSX generation
  page.tsx
  layout.tsx

components/
  chat/         ← Core chat UI components
  ui/           ← Shared design system primitives

hooks/
  use-chat-session.ts   ← Session state management
  use-stream-chat.ts    ← SSE streaming and event parsing
  use-export-file.ts    ← Document generation

lib/
  models.ts       ← Model and provider definitions
  system-prompt.ts← System prompt builder
  storage.ts      ← localStorage session persistence
  langfuse.ts     ← Observability helpers
  parse-sources.ts← Search source parsing
  file-utils.ts   ← File reading utilities
```

---

## Adding a New LLM Provider

1. **Add the model entries** in `lib/models.ts` following the existing `NyxModel` shape. Pick a unique prefix for the `id` (e.g. `"mistral/mistral-large"`).

2. **Detect the provider** in `detectProvider()` inside `app/api/chat/route.ts` — add an `if (modelId.startsWith('mistral/'))` branch returning `{ provider: 'mistral', model: ... }`.

3. **Add the provider URL** constant and handle it in `getProviderUrl()`.

4. **Build the request** — if the provider is OpenAI-compatible, add it to the `buildProviderRequest()` else-if chain. For a custom request format, add a new branch similar to the Gemini block.

5. **Add the env var** to `.env.example` with a comment, and document it in the README env table.

6. **Add to the auto-fallback order** in `AUTO_FALLBACK_ORDER` if appropriate.

---

## Reporting Bugs

[Open an issue](https://github.com/rzkyerl/nyx-agent/issues/new) and include:

- Steps to reproduce
- Expected vs. actual behavior
- Browser / Node.js / OS version
- Any relevant console errors

---

Thank you for helping make Nyx Agent better!
