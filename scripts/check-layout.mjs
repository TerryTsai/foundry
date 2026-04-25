#!/usr/bin/env node
// scripts/check-layout.mjs
//
// Confirm every packages/<name> has the required standard layout:
//   - package.json
//   - tsconfig.json
//   - README.md
//   - src/index.ts
// Exits non-zero with a concrete missing-file list on failure.

import { existsSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const PKG_ROOT = join(ROOT, 'packages')

const REQUIRED = ['package.json', 'tsconfig.json', 'README.md', 'src/index.ts']

const violations = []

for (const pkg of readdirSync(PKG_ROOT)) {
  const dir = join(PKG_ROOT, pkg)
  if (!statSync(dir).isDirectory()) continue
  for (const rel of REQUIRED) {
    if (!existsSync(join(dir, rel))) {
      violations.push(`${pkg}: missing ${rel}`)
    }
  }
}

if (violations.length === 0) {
  console.log(`layout OK (${readdirSync(PKG_ROOT).length} packages checked)`)
  process.exit(0)
}

console.error(`layout check failed (${violations.length} violation(s)):`)
for (const v of violations) console.error(`  ${v}`)
process.exit(1)
