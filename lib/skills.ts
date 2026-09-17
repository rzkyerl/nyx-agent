export interface InstalledSkill {
  id: string
  name: string
  description: string
  content: string
}

const STORAGE_KEY = 'nyx-skills'

export function loadInstalledSkills(): InstalledSkill[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const skills = Array.isArray(parsed)
      ? parsed
        .filter(skill => skill && typeof skill.name === 'string' && typeof skill.content === 'string')
        .map(skill => ({
          ...skill,
          ...parseSkillMetadata(skill.content, skill.name),
          description: getSkillDescription(skill),
        }))
      : []
    if (Array.isArray(parsed)) localStorage.setItem(STORAGE_KEY, JSON.stringify(skills))
    return skills
  } catch {
    return []
  }
}

export function saveInstalledSkills(skills: InstalledSkill[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(skills))
}

export function parseSkillMetadata(content: string, fallbackName: string): { name: string; description: string } {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/)
  const metadata = frontmatter?.[1] || ''
  const name = metadata.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim()
  const metadataLines = metadata.split(/\r?\n/)
  const descriptionIndex = metadataLines.findIndex(line => /^description:\s*/i.test(line))
  const descriptionLine = descriptionIndex >= 0 ? metadataLines[descriptionIndex].replace(/^description:\s*/i, '').trim() : ''
  const description = descriptionLine === '|' || descriptionLine === '>'
    ? (() => {
        const lines: string[] = []
        for (const line of metadataLines.slice(descriptionIndex + 1)) {
          if (!/^\s+/.test(line)) break
          lines.push(line.trim())
        }
        return lines.join(descriptionLine === '>' ? ' ' : '\n').trim()
      })()
    : descriptionLine.replace(/^(["'])(.*)\1$/, '$2')
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const summary = content
    .replace(frontmatter?.[0] || '', '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#') && !line.startsWith('```'))

  return {
    name: name || heading || fallbackName,
    description: description || summary || `Instructions for ${name || heading || fallbackName}`,
  }
}

export function getTriggeredSkills(skills: InstalledSkill[], message: string): InstalledSkill[] {
  const normalizedMessage = message.toLowerCase()
  return skills.filter(skill => {
    const terms = `${skill.name} ${skill.description}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(term => term.length >= 4)
    return terms.some(term => normalizedMessage.includes(term))
  })
}

export function getSkillDescription(skill: { name: string; description?: string; content: string }): string {
  const description = skill.description?.trim()
  const parsedDescription = parseSkillMetadata(skill.content, skill.name).description
  if (parsedDescription && !parsedDescription.startsWith('Instructions for ')) return parsedDescription
  if (description && description !== '|' && description !== '>') return description
  return parsedDescription
}