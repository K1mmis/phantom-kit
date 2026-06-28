// Beta distribution channel: wraps the same compiled engine.js in a
// Tampermonkey header and writes dist/userscript/phantom-beta.user.js.
//
// This does not compile anything and does not fetch code at runtime. The whole
// bundle is inlined into the .user.js, so Tampermonkey installs a new script
// version on update instead of evaluating remote code.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const ENGINE_SRC = resolve(ROOT, '../phantom-engine/dist/engine.js')
const OUT_DIR = join(ROOT, 'dist/userscript')
const OUT_FILE = join(OUT_DIR, 'phantom-beta.user.js')

const RELEASE_URL =
  process.env.PHANTOM_RELEASE_URL ||
  'https://raw.githubusercontent.com/K1mmis/phantom-kit/main/dist/userscript/phantom-beta.user.js'

function resolveVersion() {
  const fromArg = process.argv.find((arg) => arg.startsWith('--version='))
  if (fromArg) return fromArg.slice('--version='.length)
  if (process.env.PHANTOM_VERSION) return process.env.PHANTOM_VERSION

  try {
    const tag = execSync('git describe --tags --match "phantom-beta-v*" --abbrev=0', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    if (tag) return tag.replace(/^phantom-beta-v/, '')
  } catch {
    // No beta tag yet; fall through to package.json.
  }

  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    if (pkg.version) return `${pkg.version}-beta.0`
  } catch {
    // Ignore and use the hard fallback.
  }

  return '0.0.0-beta.0'
}

if (!existsSync(ENGINE_SRC)) {
  console.error('[phantom-kit] ERROR: engine.js not found at', ENGINE_SRC)
  console.error('  Run: cd ../phantom-engine && npm run build')
  process.exit(1)
}

const version = resolveVersion()
const engine = readFileSync(ENGINE_SRC, 'utf8')

const header = `// ==UserScript==
// @name         K1mmis Phantom BETA
// @namespace    https://k1mmis-phantom.local/
// @version      ${version}
// @description  Phantom beta channel for Tribal Wars UI tools (Dirty Mind & K1mmis)
// @author       Dirty Mind & K1mmis
// @match        *://*.tribalwars.com.pt/game.php*
// @match        *://*.tribalwars.com.br/game.php*
// @run-at       document-idle
// @grant        none
// @updateURL    ${RELEASE_URL}
// @downloadURL  ${RELEASE_URL}
// ==/UserScript==
`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, `${header}\n${engine}\n`, 'utf8')

console.log('[phantom-kit] wrote dist/userscript/phantom-beta.user.js')
console.log('  @version     ', version)
console.log('  @updateURL   ', RELEASE_URL)
