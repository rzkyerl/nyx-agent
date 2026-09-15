import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['100.120.144.74'],

  // Externalize server-only packages from client bundle
  serverExternalPackages: ['langfuse', 'mammoth'],

  // Turbopack config (Next.js 16 default bundler)
  turbopack: {
    resolveAlias: {
      // Suppress canvas warning from pdfjs-dist
      canvas: './empty-module.ts',
    },
  },
}

export default nextConfig
