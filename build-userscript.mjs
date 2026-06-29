import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { env } from 'process'

const ROOT       = fileURLToPath(new URL('.', import.meta.url))
const ENGINE_SRC = resolve(ROOT, '../phantom-engine/dist/engine.js')
const OUT_DIR    = join(ROOT, 'dist/userscript')
const OUT_FILE   = join(OUT_DIR, 'phantom-beta.user.js')

const version    = env.PHANTOM_VERSION
const releaseUrl = env.PHANTOM_RELEASE_URL

if (!version) {
  console.error('[phantom-kit] ERROR: PHANTOM_VERSION não definido')
  console.error('  ex: PHANTOM_VERSION=0.1.2-beta.1 PHANTOM_RELEASE_URL=<url> npm run build:userscript')
  process.exit(1)
}
if (!releaseUrl) {
  console.error('[phantom-kit] ERROR: PHANTOM_RELEASE_URL não definido')
  process.exit(1)
}
if (!existsSync(ENGINE_SRC)) {
  console.error('[phantom-kit] ERROR: engine.js não encontrado em', ENGINE_SRC)
  console.error('  Corre antes: cd ../phantom-engine && npm run build')
  process.exit(1)
}

const engine = readFileSync(ENGINE_SRC, 'utf8')

// O engine.js já é um IIFE (`"use strict"; (() => { ... })();`), por isso basta
// prefixar o cabeçalho. Não voltar a embrulhar em função.
//
// @grant none  → corre no contexto da página (window.game_data acessível). É o
//                equivalente userscript do "world": "MAIN" da extensão MV3.
// @noframes    → só no top frame, igual ao default da extensão (all_frames:false).
// @run-at document-idle → paridade com o manifest (game_data não existe em document-start).
const header = `// ==UserScript==
// @name         Phantom (beta)
// @icon         https://imgur.com/a/JGtiT9M
// @namespace    https://github.com/K1mmis/phantom
// @version      ${version}
// @description  Plataforma modular para Tribal Wars — canal beta
// @author       Dirty Mind & K1mmis
// @match        *://*.tribalwars.com.br/game.php*
// @match        *://*.tribalwars.com.pt/game.php*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    ${releaseUrl}
// @downloadURL  ${releaseUrl}
// ==/UserScript==
`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, header + '\n' + engine, 'utf8')

console.log('[phantom-kit] escrito', OUT_FILE)
console.log('  version  :', version)
console.log('  updateURL:', releaseUrl)
