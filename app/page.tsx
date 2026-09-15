import type { Metadata } from 'next'
import { NyxChat } from '@/components/chat/nyx-chat'

export const metadata: Metadata = {
  title:       'Nyx Agent',
  description: 'AI assistant powered by CTRL Build. Ask anything, upload files, and get real-time answers.',
}

export default function Page() {
  return <NyxChat />
}
