import { randomBytes } from 'crypto'
import { readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT = join(ROOT, 'content', 'iteration')
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const LENGTH = 6

function existingSlugs(): Set<string> {
  const slugs = new Set<string>()
  const dirs = [CONTENT, join(CONTENT, '(sprint)'), join(CONTENT, '(retrospect)')]
  for (const dir of dirs) {
    try {
      for (const file of readdirSync(dir)) {
        const match = file.match(/^([A-Z0-9]{6})\.[a-z]{2}\.mdx$/)
        if (match) slugs.add(match[1])
      }
    } catch {}
  }
  return slugs
}

function generateSlug(): string {
  const bytes = randomBytes(LENGTH)
  let slug = ''
  for (const byte of bytes) slug += ALPHABET[byte % ALPHABET.length]
  return slug
}

const taken = existingSlugs()
let slug: string
do {
  slug = generateSlug()
} while (taken.has(slug))

console.log(slug)
