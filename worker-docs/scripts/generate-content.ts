import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const contentDir = path.join(__dirname, '..', 'src', 'content')
const outputJson = path.join(__dirname, '..', 'src', 'content.json')

function walkDir(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkDir(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

const files = walkDir(contentDir)
const contentMap: Record<string, string> = {}

for (const file of files) {
  const relPath = path.relative(contentDir, file).replace(/\.md$/, '')
  const raw = fs.readFileSync(file, 'utf-8')
  contentMap[relPath] = raw
}

// Write as a plain JSON file — no template literal issues at all
fs.writeFileSync(outputJson, JSON.stringify(contentMap), 'utf-8')
console.log(`Generated ${files.length} entries -> ${outputJson}`)
