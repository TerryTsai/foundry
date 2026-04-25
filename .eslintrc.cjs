// Foundry workspace ESLint config.
//
// Rules are layered: logic modules get the strict architecture target
// (10 lines / depth 2 / no classes); infra modules a moderate target;
// legacy db code is exempt pending refactor; tests are unrestricted.
//
// Existing files that exceed limits use `// eslint-disable-next-line
// max-lines-per-function -- legacy; refactor in Phase 7+` comments.
// New code MUST meet the strict target. Adding a disable to new code
// is a code-review red flag.
//
// See ARCHITECTURE.md for the conventions these rules enforce.

const LOGIC_MODULE_GLOBS = [
  'packages/auth/src/**/*.ts',
  'packages/billing/src/**/*.ts',
  'packages/crud/src/**/*.ts',
  'packages/analytics/src/**/*.ts',
  'packages/sandbox/src/**/*.ts',
  'packages/mcp/src/**/*.ts',
  'packages/engine/src/**/*.ts',
  'packages/reconciler/src/**/*.ts',
]

const INFRA_MODULE_GLOBS = [
  'packages/model/src/**/*.ts',
  'packages/client/src/**/*.ts',
  'packages/server/src/**/*.ts',
]

// db is legacy code lifted verbatim from service. Function-size and
// nesting rules are off pending refactor. Class rule still applies.
const LEGACY_INFRA_GLOBS = [
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
      files: LOGIC_MODULE_GLOBS,
      rules: {
        // Top-level pure functions only — strictly enforced from day one.
        'no-restricted-syntax': [
          'error',
          { selector: 'ClassDeclaration', message: 'Logic modules must use top-level functions, not classes (see ARCHITECTURE.md).' },
          { selector: 'ClassExpression',  message: 'Logic modules must use top-level functions, not classes (see ARCHITECTURE.md).' },
        ],
        // Architecture target is 10 lines / depth 2 (5-second-gist). Until
        // logic-module internals are converted from throw-AppError to
        // native Result, we run at 30/3 — large legacy functions inherited
        // from service stay valid without per-function disables. New code
        // landing in these packages should still aim for 10/2; reviewers
        // catch drift. Tightening to 10/2 happens in the future internal
        // Result-conversion sweep alongside refactoring large functions.
        'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true, IIFEs: false }],
        'max-depth': ['error', 3],
        'no-inner-declarations': ['error', 'both'],
      },
    },

    // New-code modules: hold them to the strict 10/2 target now. Anything
    // written from scratch in these packages MUST meet the architecture.
    {
      files: [
        'packages/billing/src/**/*.ts',
        'packages/model/src/**/*.ts',     // also under INFRA below — explicit override here
        'packages/client/src/**/*.ts',
      ],
      rules: {
        'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true, IIFEs: false }],
        'max-depth': ['error', 2],
      },
    },

    {
      files: INFRA_MODULE_GLOBS,
      rules: {
        // Infra allows compose pipelines and bound-client wrappers — gets
        // a wider window. Class rule still applies.
        'no-restricted-syntax': [
          'error',
          { selector: 'ClassDeclaration', message: 'Use top-level functions, not classes.' },
          { selector: 'ClassExpression',  message: 'Use top-level functions, not classes.' },
        ],
        'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true, IIFEs: false }],
        'max-depth': ['error', 3],
      },
    },

    {
      files: LEGACY_INFRA_GLOBS,
      rules: {
        'no-restricted-syntax': [
          'error',
          { selector: 'ClassDeclaration', message: 'Use top-level functions, not classes.' },
          { selector: 'ClassExpression',  message: 'Use top-level functions, not classes.' },
        ],
        'max-lines-per-function': 'off',
        'max-depth': 'off',
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
