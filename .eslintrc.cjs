// Foundry workspace ESLint config.
//
// One rule for module code: 10 lines max per function, 2 levels max
// nesting, no classes. Logic and infrastructure modules share the same
// strict architecture target. Tests are unrestricted.
//
// Adding an eslint-disable to module code is a code-review red flag.
// See ARCHITECTURE.md for the conventions these rules enforce.

const MODULE_GLOBS = [
  // logic modules
  'packages/auth/src/**/*.ts',
  'packages/billing/src/**/*.ts',
  'packages/crud/src/**/*.ts',
  'packages/analytics/src/**/*.ts',
  'packages/sandbox/src/**/*.ts',
  'packages/mcp/src/**/*.ts',
  'packages/engine/src/**/*.ts',
  'packages/reconciler/src/**/*.ts',
  // infrastructure modules
  'packages/model/src/**/*.ts',
  'packages/client/src/**/*.ts',
  'packages/server/src/**/*.ts',
  'packages/db/src/**/*.ts',
]

const TEST_GLOBS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/tests/**/*.ts',
  '**/tests/**/*.tsx',
]

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

    {
      files: TEST_GLOBS,
      rules: {
        'max-lines-per-function': 'off',
        'max-depth': 'off',
        'no-restricted-syntax': 'off',
      },
    },
  ],
}
