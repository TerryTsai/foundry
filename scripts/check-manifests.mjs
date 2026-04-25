#!/usr/bin/env node
// scripts/check-manifests.mjs
//
// For every package under packages/, parse its TS imports and confirm:
//   - every imported workspace package (@foundry/*) is declared in
//     dependencies or devDependencies
//   - no logic module imports another logic module directly (only
//     @foundry/model, @foundry/client, @foundry/db are infra-importable)
//   - only the crud and analytics logic modules may import @foundry/db.
//     Every other logic module must access persistence via callbacks
//     injected by the composition root (@foundry/server).
//
// Exits non-zero with a concrete violation list on failure.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const PKG_ROOT = join(ROOT, 'packages')

const INFRA = new Set(['model', 'client', 'db'])
const LOGIC = new Set(['auth', 'billing', 'crud', 'analytics', 'sandbox', 'mcp', 'engine', 'reconciler'])

// Logic modules allowed to import @foundry/db directly. Crud owns
// persistence; analytics keeps direct read-only access for its big
// SQL aggregates (ARCHITECTURE.md flags this as a deliberate exception).
const DB_ALLOWED = new Set(['crud', 'analytics'])

const violations = []

for (const pkg of readdirSync(PKG_ROOT)) {
  const pkgDir = join(PKG_ROOT, pkg)
  if (!statSync(pkgDir).isDirectory()) continue
  checkPackage(pkg, pkgDir)
}

if (violations.length === 0) {
  console.log(`manifests OK (${readdirSync(PKG_ROOT).length} packages checked)`)
  process.exit(0)
}

console.error(`manifest check failed (${violations.length} violation(s)):`)
for (const v of violations) console.error(`  ${v}`)
process.exit(1)

function checkPackage(name, dir) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    violations.push(`${name}: missing package.json`)
    return
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])

  const srcDir = join(dir, 'src')
  if (!existsSync(srcDir)) return

  const imports = collectImports(srcDir)
  for (const { file, spec, valueOnly } of imports) {
    if (!spec.startsWith('@foundry/')) continue
    if (!declared.has(spec)) {
      violations.push(`${name}: imports ${spec} but it's not in package.json (${relative(ROOT, file)})`)
    }
    if (LOGIC.has(name)) {
      const target = spec.slice('@foundry/'.length)
      if (LOGIC.has(target)) {
        violations.push(`${name}: forbidden cross-logic-module import of ${spec} (logic modules may only import @foundry/{model,client,db}) (${relative(ROOT, file)})`)
      }
      // Type-only imports of Db/entity types are fine — they don't pull
      // any runtime drizzle/SQL code into the module. Value imports of
      // @foundry/db (the per-entity helpers) are the real coupling and
      // are restricted to crud + analytics.
      if (target === 'db' && valueOnly && !DB_ALLOWED.has(name)) {
        violations.push(`${name}: forbidden value import of @foundry/db (only crud and analytics may import db at runtime; others go through composition-root callbacks) (${relative(ROOT, file)})`)
      }
    }
  }
}

function collectImports(dir) {
  const out = []
  walk(dir, (file) => {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return
    const src = readFileSync(file, 'utf-8')
    // Match `import …` or `export … from …`. Capture the leading
    // statement so we can tell type-only forms (`import type {…}` or
    // `import { type X } from …`) apart from value imports.
    const re = /(?:^|\n)\s*(import\b[^'"`]*|export\b[^'"`]*from\s*)['"`]([^'"`]+)['"`]/g
    let m
    while ((m = re.exec(src)) !== null) {
      const head = m[1] ?? ''
      const spec = m[2]
      if (!spec) continue
      // `import type { … } from …` — entire import is type-only.
      // `import { type X, type Y } from …` — every named binding is
      // marked type, so no runtime code lands. Side-effect imports
      // (`import 'foo'`) and namespace/value imports are NOT type-only.
      const isTypeOnlyImport = /^\s*import\s+type\s/.test(head)
      const namedMatch = head.match(/\{([^}]*)\}/)
      const isAllNamedTypes = namedMatch && namedMatch[1].split(',').every(n => /^\s*type\s/.test(n) && n.trim().length > 0)
      const valueOnly = !(isTypeOnlyImport || isAllNamedTypes)
      out.push({ file, spec, valueOnly })
    }
  })
  return out
}

function walk(dir, fn) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, fn)
    else fn(p)
  }
}
