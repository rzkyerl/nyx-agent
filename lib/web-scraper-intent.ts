export function extractWebUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>()"']+/gi) || []
  return [...new Set(matches.map(raw => raw.replace(/[.,!?;:]+$/, '')))]
}

export function isBareUrlMessage(text: string): boolean {
  const urls = extractWebUrls(text)
  if (!urls.length) return false

  const withoutUrls = text
    .replace(/https?:\/\/[^\s<>()"']+/gi, ' ')
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!withoutUrls) return true

  const shortWords = withoutUrls.split(/\s+/).filter(Boolean).length
  const hasIntent = /\b(scrape|scraping|extract|extraction|summarize|summarise|ringkas|review|analyze|analisis|jelaskan|explain|what is|apa itu|apa ini|project|repository|repo|website|site|page|dokumen|document|ini apa|itu apa|what does|what is this|who is|this site|this project|this repo|apakah ini)\b/i.test(withoutUrls)

  return shortWords <= 2 && !hasIntent
}

export function detectScrapeRequest(text: string): boolean {
  if (!text || extractWebUrls(text).length === 0) return false

  const urlContext = text
    .replace(/https?:\/\/[^\s<>()"']+/gi, ' ')
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const explicitPatterns = /\b(scrape|scraping|extract|extraction|structured data|table|product|price|rating|catalog|listing|ambil data|ekstrak|ekstraksi|tabel|produk|harga|rating|daftar|data dari|ringkas|review|analyze|analisa|jelaskan|explain|what is|apa itu|apa ini|ini apa|itu apa|project|repository|repo|website|site|page|what does this site do|this project|this repo|apakah ini)\b/i

  return explicitPatterns.test(urlContext) || (urlContext.length > 0 && /\b(apa itu|apa ini|ini apa|itu apa|what is|what does|jelaskan|explain|ringkas|summarize|project|repository|repo|website|site|page|this project|this repo|this site)\b/i.test(urlContext))
}

export function detectScrapeFollowUp(text: string): boolean {
  if (!text.trim() || extractWebUrls(text).length > 0) return false
  return /\b(scrape|scraping|extract|extraction|structured data|table|product|price|rating|catalog|listing|ambil data|ekstrak|ekstraksi|tabel|produk|harga|rating|daftar|ringkas|review|analyze|analisa|jelaskan|explain|what is|apa itu|apa ini|ini apa|itu apa|project|repository|repo|website|site|page|lanjut|ya|iya|yes|please|tolong)\b/i.test(text)
}