/**
 * Build the two release artifacts from TypeScript sources.
 *
 * - `lib/index.js`: the Host plugin, an ES module loaded by the Harness Loader.
 * - `lib/client.js`: the Web client, a CommonJS body wrapped in the Harness
 *   `window.__ModuleLoader__.load()` envelope, whose `require` resolves the
 *   shared React and Harness client packages.
 */
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const define = { __PLUGIN_VERSION__: JSON.stringify(pkg.version) }

await build({
  entryPoints: ['src/host/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  define,
  logLevel: 'warning',
})

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.svg': 'dataurl' },
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
  define,
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      `  id: ${JSON.stringify(pkg.name)},`,
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
      '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    ].join('\n'),
  },
  footer: { js: '    return module.exports;\n  }\n});' },
  logLevel: 'warning',
})

console.log(`built lib/index.js and lib/client.js (${pkg.name} v${pkg.version})`)
