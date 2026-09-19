import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { cn } from '@/lib/utils'
import './globals.css'
import './chat.css'

const fontSans = Geist({ subsets: ['latin'], variable: '--font-sans' })
const fontMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title:       'Nyx Agent',
  description: 'AI assistant by CTRL Build',
  icons: {
    icon: '/images/nyx-agent/icon-mark-tab.png',
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(fontSans.variable, fontMono.variable, 'antialiased')}>
      <head>
        {/* Prevent iOS Safari from zooming in when focusing inputs */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body className="bg-background text-foreground">
        {children}
      </body>
    </html>
  )
}
