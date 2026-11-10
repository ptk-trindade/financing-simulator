// Inlines engine.js into app.html and writes two self-contained pages:
//   simulator/na-planta-flip.html  for the Claude artifact (no doctype, the host wraps it)
//   index.html                     for GitHub Pages and opening locally (full document)
// Usage: npm run build
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const template = readFileSync(join(here, 'app.html'), 'utf8')
const engine = readFileSync(join(here, 'engine.js'), 'utf8')
const marker = '<!-- ENGINE -->'
if (!template.includes(marker)) throw new Error(`Missing ${marker} in app.html`)
const out = template.replace(marker, () => `<script>\n${engine}\n</script>`)

const write = (target, text) => {
  writeFileSync(target, text)
  console.log(`Wrote ${target} (${(text.length / 1024).toFixed(1)} KB)`)
}
write(join(here, 'na-planta-flip.html'), out)
const head = '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
write(join(here, '..', 'index.html'), head + out)
