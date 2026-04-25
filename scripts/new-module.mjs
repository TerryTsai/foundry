#!/usr/bin/env node
// scripts/new-module.mjs <name>
//
// Scaffolds a new package under packages/<name> with the standard layout:
//   packages/<name>/
//   ├── package.json
//   ├── tsconfig.json
//   ├── README.md
//   ├── src/
//   │   └── index.ts
//   └── tests/
//
// Idempotent — re-running on an existing package leaves it untouched.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

const name = process.argv[2]
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('usage: scripts/new-module.mjs <name>   (lowercase, kebab-case)')
  process.exit(1)
}

const pkgDir = join(ROOT, 'packages', name)
mkdirSync(join(pkgDir, 'src'), { recursive: true })
mkdirSync(join(pkgDir, 'tests'), { recursive: true })

writeIfMissing(join(pkgDir, 'package.json'), packageJson(name))
writeIfMissing(join(pkgDir, 'tsconfig.json'), tsconfigJson(name))
writeIfMissing(join(pkgDir, 'README.md'), readme(name))
writeIfMissing(join(pkgDir, 'src', 'index.ts'), indexTs(name))

console.log(`scaffolded packages/${name}`)

function writeIfMissing(path, content) {
  if (existsSync(path)) { console.log(`  skip ${path}`); return }
  writeFileSync(path, content)
  console.log(`  wrote ${path}`)
}

function packageJson(name) {
  return JSON.stringify({
    name: `@foundry/${name}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    main: './src/index.ts',
    types: './src/index.ts',
    scripts: { build: 'tsc -b', test: 'vitest run' },
  }, null, 2) + '\n'
}

function tsconfigJson(name) {
  return JSON.stringify({
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      outDir: 'dist',
      rootDir: 'src',
    },
    include: ['src'],
    references: [],
  }, null, 2) + '\n'
}

function readme(name) {
  return `# @foundry/${name}\n\nOne-paragraph description: what this module owns and what it does NOT own.\n\nSee /ARCHITECTURE.md for the conventions every module follows.\n`
}

function indexTs(name) {
  return `// Public surface for @foundry/${name}. Re-exports go here.\nexport {}\n`
}
