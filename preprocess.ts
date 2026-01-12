import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'

// ── constants ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO = path.resolve(__dirname)
// Output roots
const PUBLIC_GENERATED = path.join(REPO, 'public', 'generated')
const ITERATION_SRC = path.join(REPO, 'Iteration')
const ITERATION_SPRINT = path.join(ITERATION_SRC, 'sprint')
const ITERATION_RETROSPECT = path.join(ITERATION_SRC, 'retrospect')
const CONTENT_ITERATION = path.join(REPO, 'content', 'iteration')

// ── helpers ──────────────────────────────────────────────────────────────────────

class CaseInsensitiveMap<T> extends Map<string, T> {
  get(key: string): T | undefined {
    return super.get(key.toLowerCase())
  }

  set(key: string, value: T): this {
    return super.set(key.toLowerCase(), value)
  }

  has(key: string): boolean {
    return super.has(key.toLowerCase())
  }

  delete(key: string): boolean {
    return super.delete(key.toLowerCase())
  }
}

function nfc(text: string): string {
  return text.normalize('NFC')
}

function randomHex(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}

const LANG_FIX_RE = /---\s*\n(.*?)\n---/s

// ── global regexes ───────────────────────────────────────────────────────────────

const WIKILINK_RE = /\[\[([^\]]+?)]]/g // raw [[…]] tokens
const CODE_BLOCK_RE = /```.*?```/gs // fenced code
const IMG_INLINE_RE = /!\[([^\]]*?)\]\(([^)]+?)\)/g // inline images anywhere
// link-style image reference (not starting with '!')
const LINK_INLINE_RE = /(^|[^!])\[([^\]]*?)\]\(([^)]+?)\)/g
const SLUG_RE = /^slug:\s+['\"]?([^\s'\"#]+)['\"]?/m
const TITLE_RE = /^title:\s+['\"]?([^\n'\"]+)['\"]?/m

// ── markdown sanitisation ────────────────────────────────────────────────────────

// simple sanitise used in legacy setup. Keep minimal fixes only.
async function sanitiseMd(root: string): Promise<void> {
  const mdFiles = await findFiles(root, ['.md', '.mdx'])
  console.log(`📝 Sanitizing ${mdFiles.length} markdown files...`)

  await Promise.all(
    mdFiles.map(async (filePath) => {
      let text = nfc(await fs.readFile(filePath, 'utf-8'))

      if (text.includes('{{hex}}') && !filePath.includes('template')) {
        text = text.replace('{{hex}}', '/' + randomHex())
      }

      const fm = text.match(LANG_FIX_RE)
      if (fm && fm[1].includes("lang: 'en'")) {
        if (!text.includes("div lang='ko") && !text.includes('div lang="ko')) {
          const fileName = path.basename(filePath)
          const koName = [...fileName].some((ch) => ch >= '\uAC00' && ch <= '\uD7A3')
          const koChars = [...text].filter((ch) => ch >= '\uAC00' && ch <= '\uD7A3').length
          const enChars = [...text].filter((ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')).length

          if (koName || koChars > enChars) {
            text = text.replace("lang: 'en'", "lang: 'ko'")
          }
        }
      }

      await fs.writeFile(filePath, text, 'utf-8')
    })
  )
  console.log(`✨ Completed markdown sanitization`)
}

// ── file utilities ───────────────────────────────────────────────────────────────

async function findFiles(dir: string, extensions: string[]): Promise<string[]> {
  const files: string[] = []

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath)
      }
    }
  }

  await walk(dir)
  return files
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src)

  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true })
    const entries = await fs.readdir(src)

    for (const entry of entries) {
      await copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    await fs.copyFile(src, dest)
  }
}

async function rmrf(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

// ── iteration → Fumadocs pipeline ────────────────────────────────────────────────

type DocMeta = {
  srcPath: string
  fileBase: string // original file base name without extension
  rawSlug?: string // slug value from frontmatter, possibly starting with '/'
  title?: string
  lang?: string
}

function slugify(input: string): string {
  return input
    .trim()
    .replace(/^\/+/, '') // drop leading slashes
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-/_]/g, '')
    .replace(/\/+/, '/')
}

function lastSegment(s: string): string {
  const parts = s.split('/')
  return parts[parts.length - 1]
}

const LANG_RE = /^lang:\s*['\"]?([a-zA-Z-]+)['\"]?/m

async function readFrontmatter(filePath: string): Promise<{ slug?: string; title?: string; lang?: string }> {
  const txt = await fs.readFile(filePath, 'utf-8')
  const slugMatch = txt.match(SLUG_RE)
  const titleMatch = txt.match(TITLE_RE)
  const langMatch = txt.match(LANG_RE)
  const slug = slugMatch ? slugify(slugMatch[1]) : undefined
  const title = titleMatch ? titleMatch[1].trim() : undefined
  const lang = langMatch ? langMatch[1].trim() : undefined
  return { slug: slug ? lastSegment(slug) : undefined, title, lang }
}

async function collectDocs(): Promise<DocMeta[]> {
  const files = [
    ...(existsSync(ITERATION_SPRINT) ? await findFiles(ITERATION_SPRINT, ['.md', '.mdx']) : []),
    ...(existsSync(ITERATION_RETROSPECT) ? await findFiles(ITERATION_RETROSPECT, ['.md', '.mdx']) : []),
  ]
  // Include root-level markdown files (e.g., Welcome.md, Welcome.ko.md, 환영합니다.md)
  try {
    const roots = await fs.readdir(ITERATION_SRC, { withFileTypes: true })
    for (const entry of roots) {
      if (!entry.isFile()) continue
      if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
        files.push(path.join(ITERATION_SRC, entry.name))
      }
    }
  } catch {}

  const out: DocMeta[] = []
  for (const f of files) {
    const base = path.basename(f, path.extname(f))
    const fm = await readFrontmatter(f)
    out.push({ srcPath: f, fileBase: base, rawSlug: fm.slug, title: fm.title, lang: fm.lang })
  }
  return out
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(CONTENT_ITERATION, { recursive: true })
  await fs.mkdir(PUBLIC_GENERATED, { recursive: true })
}

function isImagePath(p: string): boolean {
  const ext = path.extname(p).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.avif'].includes(ext)
}

async function copyToGenerated(srcFile: string): Promise<string> {
  const name = path.basename(srcFile)
  const dest = path.join(PUBLIC_GENERATED, name)
  try {
    await fs.mkdir(PUBLIC_GENERATED, { recursive: true })
    await fs.copyFile(srcFile, dest)
  } catch (e) {
    // ignore copy errors but keep reference
  }
  return `/generated/${name}`
}

async function resolveImageCandidate(candidate: string, mdFile: string): Promise<string | undefined> {
  // Strip surrounding quotes or whitespace
  let c = candidate.trim().replace(/^['\"]|['\"]$/g, '')
  if (c.startsWith('http://') || c.startsWith('https://') || c.startsWith('data:') || c.startsWith('/generated/')) {
    return undefined // external or already generated
  }

  // If it contains a query/hash, strip them for lookup
  const cleanPath = c.split('#')[0].split('?')[0]

  // If it is an absolute path inside repo
  if (path.isAbsolute(cleanPath) && existsSync(cleanPath)) return cleanPath

  // Resolve relative to md file directory
  const local = path.resolve(path.dirname(mdFile), cleanPath)
  if (existsSync(local)) return local

  // Try relative to iteration root
  const ITERATION_LOCAL = path.resolve(ITERATION_SRC, cleanPath)
  if (existsSync(ITERATION_LOCAL)) return ITERATION_LOCAL

  // Try iteration/assets/<basename>
  const base = path.basename(cleanPath)
  const assetsCandidate = path.join(ITERATION_SRC, 'assets', base)
  if (existsSync(assetsCandidate)) return assetsCandidate

  return undefined
}

async function rewriteImages(txt: string, mdFile: string): Promise<string> {
  // 1) ![[...]] wikilink images → ![alt](/generated/name)
  txt = await replaceAsync(txt, /!\[\[([^\]]+?)\]\]/g, async (_m, p1: string) => {
    const target = p1.trim()
    if (!isImagePath(target)) {
      // Might be a relative path without extension; try to find in assets by name with any known extension
      const guesses = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
      for (const ext of guesses) {
        const found = await resolveImageCandidate(target + ext, mdFile)
        if (found) {
          const href = await copyToGenerated(found)
          return `![](${href})`
        }
      }
      return `![${target}](${target})` // fallback unchanged
    }

    const srcFile = await resolveImageCandidate(target, mdFile)
    if (srcFile) {
      const href = await copyToGenerated(srcFile)
      return `![](${href})`
    }
    return `![](${target})`
  })

  // 2) Regular markdown images: ![alt](src) → copy to /generated
  txt = await replaceAsync(txt, IMG_INLINE_RE, async (m, alt: string, src: string) => {
    const cand = src.trim()
    if (
      cand.startsWith('http://') ||
      cand.startsWith('https://') ||
      cand.startsWith('data:') ||
      cand.startsWith('/generated/')
    ) {
      return m // leave as-is
    }
    const srcFile = await resolveImageCandidate(cand, mdFile)
    if (!srcFile) return m
    const href = await copyToGenerated(srcFile)
    return `![${alt}](${href})`
  })

  // 3) Link-style images: [caption](src) → <Figure src=... caption=... />
  // Only applies when the target resolves to a local image asset.
  txt = await replaceAsync(txt, LINK_INLINE_RE, async (m, pre: string, caption: string, src: string) => {
    const cand = src.trim()
    // Ignore external/data links
    if (
      cand.startsWith('http://') ||
      cand.startsWith('https://') ||
      cand.startsWith('data:') ||
      cand.startsWith('/generated/')
    ) {
      return m
    }
    // Only proceed if it looks like an image path or resolves to an image file
    const srcFile = await resolveImageCandidate(cand, mdFile)
    if (!srcFile || !isImagePath(srcFile)) return m
    const href = await copyToGenerated(srcFile)
    const cap = caption.trim()
    const capLiteral = JSON.stringify(cap)
    // Preserve the leading character (if any) captured by the regex
    return `${pre}<Figure src="${href}" alt=${capLiteral} caption=${capLiteral} />`
  })

  // 4) Fallback: any remaining references to ../assets inside parentheses → copy to /generated
  // This covers edge cases where alt text contains ']' and our IMG_INLINE_RE misses it.
  txt = await replaceAsync(txt, /\]\((\.\.\/assets\/[^)#]+)\)/g, async (m: string, cand: string) => {
    const srcFile = await resolveImageCandidate(cand, mdFile)
    if (!srcFile) return m
    const href = await copyToGenerated(srcFile)
    return m.replace(cand, href)
  })

  return txt
}

function normalizeCodeFences(txt: string): string {
  // Downgrade unsupported languages to plain fence to avoid Shiki errors
  // e.g., ```dataview → ```
  return txt.replace(/^```dataview\b/gm, '```')
}

async function replaceAsync(str: string, regex: RegExp, asyncFn: (...args: any[]) => Promise<string>): Promise<string> {
  const promises: Promise<string>[] = []
  const parts: string[] = []
  let lastIndex = 0
  for (const match of str.matchAll(regex)) {
    const matchStr = match[0]
    const index = match.index ?? 0
    parts.push(str.slice(lastIndex, index))
    // @ts-ignore
    promises.push(asyncFn(...match))
    lastIndex = index + matchStr.length
  }
  parts.push(str.slice(lastIndex))
  const resolved = await Promise.all(promises)
  let out = ''
  for (let i = 0; i < resolved.length; i++) {
    out += parts[i] + resolved[i]
  }
  out += parts[parts.length - 1]
  return out
}

function buildNameToSlugMap(metas: DocMeta[]): CaseInsensitiveMap<string> {
  const map = new CaseInsensitiveMap<string>()
  for (const m of metas) {
    const slug = (m.rawSlug && lastSegment(m.rawSlug)) || slugify(m.fileBase)
    map.set(nfc(m.fileBase), slug)
    map.set(nfc(slug), slug)
    if (m.title) map.set(nfc(m.title), slug)
  }
  return map
}

function replaceDocWikilinks(txt: string, linkMap: CaseInsensitiveMap<string>): string {
  const parts: string[] = []
  let lastIndex = 0
  const matches = [...txt.matchAll(CODE_BLOCK_RE)]

  for (const match of matches) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const outside = txt.slice(lastIndex, start)
    const processedOutside = outside.replace(WIKILINK_RE, (full, inner: string) => {
      // Ignore image wikilinks handled separately: they start with '![[', which won't be caught here
      const raw = String(inner)
      if (!raw || raw[0] === ' ' || raw[raw.length - 1] === ' ' || raw.trimStart().startsWith('-')) {
        return full
      }
      const [target, display] = raw.includes('|') ? raw.split('|', 2) : [raw, raw]
      const slug = linkMap.get(nfc(target))
      if (!slug) return full
      return `[${display}](${encodeURI('./' + slug)})`
    })
    parts.push(processedOutside)
    parts.push(match[0])
    lastIndex = end
  }

  const remainder = txt.slice(lastIndex)
  const processedRemainder = remainder.replace(WIKILINK_RE, (full, inner: string) => {
    const raw = String(inner)
    if (!raw || raw[0] === ' ' || raw[raw.length - 1] === ' ' || raw.trimStart().startsWith('-')) {
      return full
    }
    const [target, display] = raw.includes('|') ? raw.split('|', 2) : [raw, raw]
    const slug = linkMap.get(nfc(target))
    if (!slug) return full
    return `[${display}](${encodeURI('./' + slug)})`
  })
  parts.push(processedRemainder)
  return parts.join('')
}

async function processiterationToFumadocs(): Promise<void> {
  console.log('📚 Processing iteration → Fumadocs content/iteration ...')
  await ensureDirs()

  const metas = await collectDocs()
  const linkMap = buildNameToSlugMap(metas)

  // Clean output dir before writing
  await rmrf(CONTENT_ITERATION)
  await fs.mkdir(CONTENT_ITERATION, { recursive: true })

  // Create subdirectories for journal and memex
  const sprintDir = path.join(CONTENT_ITERATION, '(sprint)')
  const retrospectDir = path.join(CONTENT_ITERATION, '(retrospect)')
  await fs.mkdir(sprintDir, { recursive: true })
  await fs.mkdir(retrospectDir, { recursive: true })

  for (const meta of metas) {
    const preferredSlug = (meta.rawSlug && lastSegment(meta.rawSlug)) || slugify(meta.fileBase)
    const lang = (meta.lang || 'en').toLowerCase()

    // Determine output directory based on source folder or filename pattern
    let outputDir = CONTENT_ITERATION

    // Prefer folder-based mapping: if the source file lives under
    // Iteration/retrospect or Iteration/sprint (or Iteration/journals), map accordingly.
    try {
      const rel = path.relative(ITERATION_SRC, meta.srcPath)
      const first = rel.split(path.sep)[0]
      if (first === 'retrospect') {
        outputDir = retrospectDir
      } else if (first === 'sprint') {
        outputDir = sprintDir
      }
    } catch {}

    // Special case: 000000 stays at root level
    if (preferredSlug === '000000' || meta.fileBase === '000000') {
      outputDir = CONTENT_ITERATION
    }

    // Do not add language to filename; keep a single canonical filename
    const outFile = path.join(outputDir, `${preferredSlug}.${lang}.mdx`)
    const raw = await fs.readFile(meta.srcPath, 'utf-8')
    // rewrite images first
    let body = await rewriteImages(raw, meta.srcPath)
    // then resolve doc wikilinks
    body = replaceDocWikilinks(body, linkMap)
    // normalize code fences (unsupported languages)
    body = normalizeCodeFences(body)
    // ensure frontmatter contains title derived from original filename
    body = ensureFrontmatterTitle(body, meta.fileBase, preferredSlug, lang)
    await fs.writeFile(outFile, body, 'utf-8')
  }

  // Write folder metadata files
  await writeSprintMeta(sprintDir)
  await writeRetrospectMeta(retrospectDir)

  console.log('✅ Wrote docs into content/iteration')
}

// Inject or update frontmatter title with source filename and keep slug/lang
function ensureFrontmatterTitle(raw: string, filenameBase: string, preferredSlug: string, lang: string): string {
  const esc = (s: string) => `'${s.replace(/'/g, "''")}'`

  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (fmMatch) {
    let fm = fmMatch[1]
    // Insert title only if missing; keep existing title as priority
    if (!/^title:/m.test(fm)) {
      fm = `title: ${esc(filenameBase)}\n${fm}`
    }
    // Keep body as-is
    const header = `---\n${fm}\n---\n`
    const body = raw.slice(fmMatch[0].length)
    return header + body
  }
  const headerLines = [
    `title: ${esc(filenameBase)}`,
    preferredSlug ? `slug: '/${preferredSlug}'` : undefined,
    lang ? `lang: ${esc(lang)}` : undefined,
  ].filter(Boolean)
  const header = `---\n${headerLines.join('\n')}\n---\n`
  return header + raw
}

// ── meta writers ────────────────────────────────────────────────────────────────

// ── meta writers ────────────────────────────────────────────────────────────────
function stripLangSuffix(id: string) {
  return id.replace(/\.(ko|en)$/i, '')
}

/**
 * 파일 내용(Frontmatter)을 읽어서 날짜와 ID를 추출하는 함수
 * 기준: newsletter: '{{date:YYYY-MM-DD}}'
 */
async function getSourceTimeMap(sourceDir: string): Promise<Map<string, number>> {
  const timeMap = new Map<string, number>()

  // newsletter 패턴 정규식: newsletter: '{{date:2026-01-02}}'
  const NEWSLETTER_RE = /newsletter:\s*['"]?\{\{date:(\d{4}-\d{2}-\d{2})\}\}['"]?/

  try {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.mdx')))

    await Promise.all(
      files.map(async (e) => {
        const fullPath = path.join(sourceDir, e.name)

        // 1. 파일 내용 읽기
        const content = await fs.readFile(fullPath, 'utf-8')

        // 2. ID (Slug) 추출
        const slugMatch = content.match(SLUG_RE)
        let id = ''
        if (slugMatch && slugMatch[1]) {
          const parts = slugMatch[1].split('/')
          id = parts[parts.length - 1]
        } else {
          const baseName = stripLangSuffix(path.basename(e.name, path.extname(e.name)))
          id = slugify(baseName)
        }

        // 3. 날짜 (Newsletter) 추출
        let time = 0
        const dateMatch = content.match(NEWSLETTER_RE)

        if (dateMatch && dateMatch[1]) {
          // '2026-01-02' 문자열을 타임스탬프로 변환
          time = new Date(dateMatch[1]).getTime()
        } else {
          // newsletter 필드가 없으면 파일 생성일(birthtime)을 fallback으로 사용
          const stat = await fs.stat(fullPath)
          time = stat.birthtime.getTime()
        }

        // 4. Map에 저장 (ko/en 중 더 최신 날짜 유지)
        if (id) {
          const existingTime = timeMap.get(id) || 0
          if (time > existingTime) {
            timeMap.set(id, time)
          }
        }
      })
    )
  } catch (e) {
    console.error(`Error reading source dir ${sourceDir}:`, e)
  }
  return timeMap
}

async function writeSprintMeta(sprintDir: string): Promise<void> {
  // 소스 파일 시간 맵 가져오기 (이제 키가 '0EBC19' 같은 형식이 됨)
  const sourceTimeMap = await getSourceTimeMap(ITERATION_SPRINT)

  const metaPath = path.join(sprintDir, 'meta.json')
  const entries = await fs.readdir(sprintDir, { withFileTypes: true })

  const mdxFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.mdx'))

  const filesWithTime = mdxFiles.map((e) => {
    const id = stripLangSuffix(path.basename(e.name, '.mdx'))
    // 이제 ID가 서로 매칭되므로 시간을 찾을 수 있음
    const time = sourceTimeMap.get(id) || 0
    return { id, time }
  })

  // 최신순 정렬 (mtime 기준)
  filesWithTime.sort((a, b) => b.time - a.time)

  const unique = Array.from(new Set(filesWithTime.map((f) => f.id)))
  await fs.writeFile(metaPath, `${JSON.stringify({ pages: unique }, null, 2)}\n`, 'utf-8')
}

async function writeRetrospectMeta(retrospectDir: string): Promise<void> {
  const sourceTimeMap = await getSourceTimeMap(ITERATION_RETROSPECT)

  const metaPath = path.join(retrospectDir, 'meta.json')
  const entries = await fs.readdir(retrospectDir, { withFileTypes: true })

  const mdxFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.mdx'))

  const filesWithTime = mdxFiles.map((e) => {
    const id = stripLangSuffix(path.basename(e.name, '.mdx'))
    const time = sourceTimeMap.get(id) || 0
    return { id, time }
  })

  filesWithTime.sort((a, b) => b.time - a.time)

  const unique = Array.from(new Set(filesWithTime.map((f) => f.id)))
  await fs.writeFile(metaPath, `${JSON.stringify({ pages: unique }, null, 2)}\n`, 'utf-8')
}

// ── entry point ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🚀 Starting preprocessing...')

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      clean: {
        type: 'boolean',
        default: false,
      },
    },
  })

  // Basic sanitisation on original iteration if needed
  await sanitiseMd(ITERATION_SRC)

  // Build Fumadocs-compatible content
  await processiterationToFumadocs()

  // Newsroom images are handled via MDX (remarkImage + remarkFigureImport)

  console.log('✅ Preprocess completed for Fumadocs.')
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
