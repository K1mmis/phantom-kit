import { cpSync, mkdirSync, existsSync } from 'fs'
import { argv } from 'process'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const ENGINE_SRC = resolve(ROOT, '../phantom-engine/dist/engine.js')
const OUT_DIR = join(ROOT, 'dist/extension')

if (!existsSync(ENGINE_SRC)) {
  console.error('[phantom-kit] ERROR: engine.js not found at', ENGINE_SRC)
  console.error('  Run: cd ../phantom-engine && npm run build')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })

cpSync(ENGINE_SRC, join(OUT_DIR, 'engine.js'))
cpSync(join(ROOT, 'manifest.json'), join(OUT_DIR, 'manifest.json'))

console.log('[phantom-kit] assembled dist/extension/')
console.log('  manifest.json')
console.log('  engine.js')
console.log()
console.log('  Load as unpacked extension at chrome://extensions (developer mode)')

if (argv.includes('--zip')) {
  // TODO: add archiver devDependency when release packaging is needed
  console.warn('[phantom-kit] --zip not implemented in v1')
  process.exit(1)
}
