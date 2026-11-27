import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { test } from 'node:test'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('pi-ai is a build-time dependency, not an installed plugin dependency', () => {
  assert.equal(pkg.dependencies['@earendil-works/pi-ai'], undefined)
  assert.equal(pkg.devDependencies['@earendil-works/pi-ai'], '~1.3.0')
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies)
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies)
})

test('the shipped host bundle needs only Harness modules, undici and Node builtins', async () => {
  const result = await build({
    absWorkingDir: new URL('..', import.meta.url).pathname,
    entryPoints: ['lib/index.js'], bundle: false, write: false,
    platform: 'node', format: 'esm', metafile: true, logLevel: 'silent',
  })
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports)
  assert.ok(imports.some(item => item.path.startsWith('@deepseek-ai/')), 'Harness modules must stay external')
  for (const item of imports) {
    assert.ok(item.path.startsWith('@deepseek-ai/') || item.path === 'undici'
      || builtinModules.includes(item.path.replace(/^node:/, '')), `unbundled runtime dependency: ${item.path}`)
  }
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node_modules\/(?:@google\/genai|protobufjs|@aws-sdk)\//, 'unused provider SDKs must not be embedded')
  assert.ok(pkg.files.includes('THIRD_PARTY_NOTICES.txt'))
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8')
  const bundled = [...new Set([...source.matchAll(/node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g)].map(match => match[1]))]
  assert.ok(bundled.includes('@earendil-works/pi-ai'), 'public pi-ai transports must be embedded')
  for (const name of bundled) {
    const dependency = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'))
    assert.ok(notices.includes(`${name}@${dependency.version}\n`), `missing bundled license: ${name}`)
  }
})
