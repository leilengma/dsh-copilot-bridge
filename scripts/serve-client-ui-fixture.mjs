// Local-only browser fixture. Open the printed URL in a scratch tab; Ctrl-C stops it.
// Models uses production components/state with fake fetch, never desktop credentials.
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({
  absWorkingDir: root,
  entryPoints: ['tests/fixtures/models-ui.tsx'],
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  alias: { '@deepseek-ai/dsh-client-ui-primitives': `${root}tests/fixtures/ui-primitives.tsx` },
})
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Copilot Models — isolated UI fixture</title>
<style>
:root { color-scheme: light dark; --dsw-alias-label-primary: light-dark(#202124,#eee); --dsw-alias-label-secondary: light-dark(#555,#bbb); --dsw-alias-label-tertiary: light-dark(#666,#aaa); --dsw-alias-border-l2: light-dark(#ccc,#555); --dsw-alias-bg-layer-1: light-dark(#fff,#222); }
body { font: 14px system-ui; margin: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
button { display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
button:hover { background: light-dark(#eee,#444); } button:focus-visible { outline: 2px solid currentColor; } button:disabled { opacity: .4; cursor: default; }
input { padding: 8px; box-sizing: border-box; }
</style><h1>Copilot Models — isolated UI fixture</h1><p>No desktop profile, credentials, network or inference. Harness presentation primitives are replaced with semantic DOM adapters.</p><div id="root"></div><script type="module" src="/fixture.js"></script></html>`
const server = createServer((request, response) => {
  if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end(html) }
  else if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(result.outputFiles[0].text) }
  else if (request.url === '/favicon.ico') { response.writeHead(204); response.end() }
  else { response.writeHead(404); response.end() }
})
server.listen(0, '127.0.0.1', () => { console.log(`http://127.0.0.1:${server.address().port}/`) })
