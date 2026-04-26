// Foundry workspace ESLint config.
//
// Module code is held to a strict shape: 20-line function cap, depth ≤ 2,
// no classes. Logic modules also obey the cardinal rule (no peer
// imports, no @foundry/db value imports outside crud/analytics) — that
// rule is enforced here so it can't drift between packages. Tests are
// unrestricted.
//
// Adding an eslint-disable to module code is a code-review red flag.
// See ARCHITECTURE.md for the conventions these rules enforce.

const LOGIC_MODULES = [
  'auth', 'billing', 'crud', 'analytics',
  'sandbox', 'mcp', 'engine', 'reconciler',
]

// Modules permitted to value-import @foundry/db. Everyone else gets type
// access only — runtime persistence flows through composition-root
// callbacks (EngineDeps, ReconcilerCrudOps, AuthCrudOps, etc.).
const DB_VALUE_ALLOWED = new Set(['crud', 'analytics'])

const MODULE_GLOBS = [
  ...LOGIC_MODULES.map(m => `packages/${m}/src/**/*.ts`),
  // Infrastructure modules — same shape rules, no cardinal rule (they're
  // the freely-importable foundation everything else sits on).
  'packages/model/src/**/*.ts',
  'packages/client/src/**/*.ts',
  'packages/db/src/**/*.ts',
  // Composition root — same shape rules apply, but it's the one place
  // allowed to import every logic module directly.
  'server/src/**/*.ts',
]

const TEST_GLOBS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/tests/**/*.ts',
  '**/tests/**/*.tsx',
]

// Per-logic-module cardinal-rule overrides. Each forbids importing every
// OTHER logic module's package, plus restricts @foundry/db value imports
// for non-{crud,analytics} (type imports stay legal so entity types can
// thread through callback bundles).
const cardinalRuleOverrides = LOGIC_MODULES.map(self => {
  const restrictedPaths = LOGIC_MODULES
    .filter(other => other !== self)
    .map(other => ({
      name: `@foundry/${other}`,
      message: `Cardinal rule: logic module '${self}' cannot import logic module '${other}'. Cross-module work goes through @foundry/client or callback bundles injected by @foundry/server. See ARCHITECTURE.md.`,
    }))
  if (!DB_VALUE_ALLOWED.has(self)) {
    restrictedPaths.push({
      name: '@foundry/db',
      allowTypeImports: true,
      message: `Logic module '${self}' may only type-import @foundry/db. Runtime persistence is restricted to crud and analytics; everyone else goes through callbacks from @foundry/server. See ARCHITECTURE.md.`,
    })
  }
  return {
    files: [`packages/${self}/src/**/*.ts`],
    rules: {
      // Use the @typescript-eslint variant — it understands the
      // allowTypeImports option, which the base eslint rule does not.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { paths: restrictedPaths }],
    },
  }
})

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  ignorePatterns: [
    'dist/', 'node_modules/', '*.config.*', '*.cjs',
    'packages/site/**', 'packages/admin/**',     // SPAs not under these rules; Vite handles them
  ],
  rules: {},

  overrides: [
    {
      files: MODULE_GLOBS,
      rules: {
        // Top-level pure functions only. No classes, no closure-based
        // factories outside the explicit infra carve-outs in
        // ARCHITECTURE.md (which are module-by-module, not rule-encoded).
        'no-restricted-syntax': [
          'error',
          { selector: 'ClassDeclaration', message: 'Use top-level functions, not classes (see ARCHITECTURE.md).' },
          { selector: 'ClassExpression',  message: 'Use top-level functions, not classes (see ARCHITECTURE.md).' },
        ],
        // Architecture target: 5-second-gist. The hard limit is 20
        // lines (covers signature + ~10-15 body lines including the
        // closing brace) — enough to absorb tight object-builder
        // functions, validation pipelines, and SQL aggregates without
        // forcing splits that hurt readability. Functions that need
        // more should genuinely be decomposed.
        'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true, IIFEs: false }],
        'max-depth': ['error', 2],
        'no-inner-declarations': ['error', 'both'],
      },
    },

    ...cardinalRuleOverrides,

    {
      files: TEST_GLOBS,
      rules: {
        'max-lines-per-function': 'off',
        'max-depth': 'off',
        'no-restricted-syntax': 'off',
        'no-restricted-imports': 'off',
        '@typescript-eslint/no-restricted-imports': 'off',
      },
    },
  ],
}
