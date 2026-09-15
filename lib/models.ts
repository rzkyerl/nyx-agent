/* ═══════════════════════════════════════════════════
   Nyx Agent — Model definitions
   Replaces the template's Vercel AI Gateway models
═══════════════════════════════════════════════════ */

export interface NyxModel {
  id: string
  label: string
  vendor: string
  description: string
  tags: string[]
  experimental?: boolean
}

export const AUTO_MODEL_ID = 'auto'

export const NIM_MODELS: NyxModel[] = [
  {
    id:          AUTO_MODEL_ID,
    label:       'Auto',
    vendor:      'System',
    description: 'Automatically picks the best available model',
    tags:        ['Smart'],
  },
  {
    id:          'openai/gpt-oss-20b',
    label:       'GPT OSS - 20B',
    vendor:      'NIM',
    description: 'Good all-around model for everyday tasks',
    tags:        ['Versatile'],
  },
  {
    id:          'deepseek-ai/deepseek-v4-pro-0813',
    label:       'DeepSeek V4 Pro',
    vendor:      'NIM',
    description: 'Deeper reasoning for complex questions',
    tags:        ['Reasoning'],
  },
  {
    id:          'deepseek-ai/deepseek-v4-flash-0731',
    label:       'DeepSeek V4 Flash',
    vendor:      'NIM',
    description: 'Quick responses for simple queries',
    tags:        ['Quick'],
  },
  {
    id:          'moonshotai/kimi-k3',
    label:       'Kimi K3',
    vendor:      'NIM',
    description: 'Handles very long conversations & documents',
    tags:        ['Extended'],
  },
  {
    id:          'nvidia/nemotron-3-ultra-550b-a55b',
    label:       'Nemotron 3 Ultra',
    vendor:      'NIM',
    description: 'Most capable model for difficult tasks',
    tags:        ['Powerful'],
  },
  // --- Groq models (100% free, fast LPU inference) ---
  {
    id:          'groq/groq/compound',
    label:       'Compound (Groq)',
    vendor:      'Groq',
    description: 'Ultra-fast free inference, great for quick chats',
    tags:        ['Free', 'Fast'],
  },
  {
    id:          'groq/openai/gpt-oss-120b',
    label:       'GPT OSS - 120B (Groq)',
    vendor:      'Groq',
    description: 'Large free model for deeper reasoning',
    tags:        ['Free', 'Reasoning'],
  },
  {
    id:          'groq/qwen/qwen3.6-27b',
    label:       'Qwen 3.6-27B (Groq)',
    vendor:      'Groq',
    description: 'Strong multilingual support, 131K context',
    tags:        ['Free', 'Multilingual'],
  },
  {
    id:          'groq/groq/compound-mini',
    label:       'Compound Mini (Groq)',
    vendor:      'Groq',
    description: 'Lightning-fast free model for simple tasks',
    tags:        ['Free', 'Lite'],
  },
  // --- Gemini models ---
  {
    id:          'gemini/gemini-3.1-pro-preview',
    label:       'Gemini 3.1 Pro · Preview',
    vendor:      'Gemini',
    description: 'Most capable free Gemini model for complex tasks',
    tags:        ['Free', 'Multimodal', 'Reasoning'],
  },
  {
    id:          'gemini/gemini-3.6-flash',
    label:       'Gemini 3.6 Flash',
    vendor:      'Gemini',
    description: 'Balanced Gemini model speed and quality',
    tags:        ['Free', 'Multimodal', 'Fast'],
  },
  {
    id:          'gemini/gemini-3.5-flash-lite',
    label:       'Gemini 3.5 Flash Lite',
    vendor:      'Gemini',
    description: 'Fastest, lowest-cost Gemini model for simple tasks',
    tags:        ['Free', 'Multimodal', 'Lite'],
  },
  // --- Ollama models (self-hosted) ---
  {
    id:          'ollama/llama3.1:8b',
    label:       'Llama 3.1 8B · Preview',
    vendor:      'Ollama',
    description: 'Open-source Llama 3.1 8B · Self-hosted inference, early access',
    tags:        ['Preview', 'Experimental'],
    experimental: true,
  },
  {
    id:          'ollama/qwen2.5:7b',
    label:       'Qwen 2.5 7B · Preview',
    vendor:      'Ollama',
    description: 'Alibaba Qwen 2.5 7B · Strong multilingual & coding, self-hosted',
    tags:        ['Preview', 'Experimental'],
    experimental: true,
  },
]

export const DEFAULT_MODEL = NIM_MODELS[0]
