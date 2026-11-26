import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('installed bundle metadata retains the GitHub Copilot display title in both locales', () => {
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.ok(pkg.files.includes('locale/*.json'))
  for (const language of ['en', 'zh']) {
    const resource = `dsh-copilot-bridge/locale/${language}.json`
    const { meta } = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(resource)), 'utf8'))
    assert.equal(meta.title, 'GitHub Copilot')
    assert.equal(typeof meta.description, 'string')
    assert.ok(meta.description.length > 0)
  }
})

test('plugin metadata exposes a packaged SVG icon to the Harness plugin manager', () => {
  assert.equal(pkg.icon, 'assets/github-copilot.svg')
  assert.ok(pkg.files.includes('assets/github-copilot.svg'))
  assert.equal(fileURLToPath(import.meta.resolve('dsh-copilot-bridge/icon')), fileURLToPath(new URL('../assets/github-copilot.svg', import.meta.url)))
  const svg = readFileSync(new URL(`../${pkg.icon}`, import.meta.url), 'utf8')
  assert.ok(Buffer.byteLength(svg) < 256 * 1024, 'Harness limits icons to 256 KiB')
  assert.match(svg, /<svg[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  assert.match(svg, /viewBox="0 2.5 24 19"/)
  assert.match(svg, /fill="#000"/)
  assert.match(svg, /@media\s*\(prefers-color-scheme:\s*dark\)/)
  assert.match(svg, /fill:\s*#fff/)
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|href=/)
})
