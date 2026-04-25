// Foundry workspace ESLint config.
//
// Rules are layered: a base set applies to all TS code, then per-module
// overrides activate stricter rules as each module is migrated. See
// ARCHITECTURE.md for the conventions these rules enforce.

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

// db is legacy code lifted from service — gets a temporary exemption
// from function-size and nesting rules. Phase 7 will refactor.
const LEGACY_INFRA_GLOBS = [
  'packages/db/src/**/*.ts',
]

const TEST_GLOBS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/tests/**/*.ts',
]

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['dist/', 'node_modules/', '*.config.*', '*.cjs'],
  rules: {},

  overrides: [
    {
      files: LOGIC_MODULE_GLOBS,
      rules: {
        // Logic modules: top-level pure functions only. No classes.
        'no-restricted-syntax': [
          'error',
          { selector: 'ClassDeclaration', message: 'Logic modules must use top-level functions, not classes (see ARCHITECTURE.md).' },
          { selector: 'ClassExpression',  message: 'Logic modules must use top-level functions, not classes (see ARCHITECTURE.md).' },
        ],
        // Migration-window settings. The architecture target is 10 lines /
        // depth 2; we relax to 30 / 3 during Phase 4 physical moves and
        // tighten in Phase 7 alongside Result conversion. New code (model,
        // client, billing, etc.) must meet the strict target — see those
        // modules' own override below if they need to opt into the strict
        // rule earlier.
        'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true, IIFEs: false }],
        'max-depth': ['error', 3],
        'no-inner-declarations': ['error', 'both'],
      },
    },

    // New-code modules: hold them to the strict 10-line / depth-2 target
    // immediately. Anything written from scratch in these packages gets
    // the full architecture rules.
    {
      files: [
        'packages/billing/src/**/*.ts',
      ],
      rules: {
        'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true, IIFEs: false }],
        'max-depth': ['error', 2],
      },
    },

    {
      files: INFRA_MODULE_GLOBS,
      rules: {
        // Infra allows closure factories (adapters, bind, compose) but still
        // bans classes and keeps function size + nesting in check.
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
