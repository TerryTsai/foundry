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

const LOGIC_FEATURE_GLOBS = LOGIC_MODULES.map(m => `packages/${m}/src/**/*.ts`)

// Files where shape declarations live: zod schemas, type aliases,
// interfaces, error unions, module-wide constants. Strict feature-file
// rules (no module-level vars / interfaces / type aliases / zod imports)
// do NOT apply here.
const SCHEMA_FILES = [
  '**/schema.ts',
  // Transitional names — migrating to schema.ts during the standard rollout.
  '**/types.ts',
  '**/validators.ts',
  // mcp's per-integration tools.ts files declare each tool's zod schema
  // inline; the schema IS part of the tool's identity, not a side detail.
  '**/integrations/*/tools.ts',
  '**/tools/*.ts',
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
// thread through callback bundles). Feature files additionally forbid
// zod imports — schemas + inferred types live in schema.ts (or mcp's
// tools.ts, which is in SCHEMA_FILES). Type-only zod imports are
// allowed because some engine adapters need ZodObject etc. structurally
// without pulling in zod's runtime.
const cardinalRuleOverrides = LOGIC_MODULES.flatMap(self => {
  const cardinalPaths = LOGIC_MODULES
    .filter(other => other !== self)
    .map(other => ({
      name: `@foundry/${other}`,
      message: `Cardinal rule: logic module '${self}' cannot import logic module '${other}'. Cross-module work goes through @foundry/client or callback bundles injected by @foundry/server. See ARCHITECTURE.md.`,
    }))
  if (!DB_VALUE_ALLOWED.has(self)) {
    cardinalPaths.push({
      name: '@foundry/db',
      allowTypeImports: true,
      message: `Logic module '${self}' may only type-import @foundry/db. Runtime persistence is restricted to crud and analytics; everyone else goes through callbacks from @foundry/server. See ARCHITECTURE.md.`,
    })
  }
  const zodPattern = {
    group: ['zod', 'zod/*'],
    allowTypeImports: true,
    message: `zod value imports belong in schema.ts (or a tools.ts file for mcp integrations). Feature files consume validated values via parameters; schema.ts re-exports inferred types for consumers.`,
  }
  return [
    // All files in this module: cardinal restrictions only. Schema files
    // need to import zod values; feature files use the override below.
    {
      files: [`packages/${self}/src/**/*.ts`],
      rules: {
        'no-restricted-imports': 'off',
        '@typescript-eslint/no-restricted-imports': ['error', { paths: cardinalPaths }],
      },
    },
    // Feature files only: cardinal restrictions + zod ban (value imports
    // forbidden, type imports allowed). Last-write-wins replaces the
    // override above for feature files.
    {
      files: [`packages/${self}/src/**/*.ts`],
      excludedFiles: SCHEMA_FILES,
      rules: {
        'no-restricted-imports': 'off',
        '@typescript-eslint/no-restricted-imports': ['error', {
          paths: cardinalPaths,
          patterns: [zodPattern],
        }],
      },
    },
  ]
})

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // Type-aware linting (no-floating-promises, consistent-type-imports).
    // `project: true` makes the parser find each file's closest
    // tsconfig.json, so each package's project references resolve.
    project: true,
    tsconfigRootDir: __dirname,
  },
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

        // Type safety. Locks in the type-tightening sweep — covers `: any`,
        // `as any`, `<any>`, `Array<any>`, etc. The next regression fails
        // lint instead of slipping in.
        '@typescript-eslint/no-explicit-any': 'error',

        // Make type-vs-value imports explicit. The cardinal rule's
        // db-restriction depends on this distinction (allowTypeImports);
        // forcing every type-only import to use `import type { … }` keeps
        // the rule's behavior unambiguous.
        '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],

        // Async-always at the client boundary. Floating promises silently
        // swallow errors and break that contract.
        '@typescript-eslint/no-floating-promises': 'error',

        // Cheap correctness wins. `eqeqeq` keeps the `== null` / `!= null`
        // idiom (catches both null AND undefined in one comparison) — the
        // alternative is `=== null || === undefined` everywhere, which
        // hurts readability without changing semantics.
        'eqeqeq': ['error', 'always', { null: 'ignore' }],
        'no-throw-literal': 'error',
      },
    },

    ...cardinalRuleOverrides,

    // ── Strict feature-file rules (logic modules only) ──────────────
    // Feature files in logic modules are a single shape: imports +
    // function declarations. No module-level variables, no top-level
    // interface/type declarations, no zod imports. Shape declarations
    // (types, schemas, registries) live in schema.ts (or the listed
    // legacy/special files in SCHEMA_FILES). Wiring (intervals,
    // singletons, registries) lives in @foundry/server.
    //
    // The principle: AI sessions arrive without memory. Module-level
    // constants and inline types are different across sessions; strict
    // file-shape consistency is the only thing that holds. Repetition
    // beats abstraction. See ARCHITECTURE.md.
    {
      files: LOGIC_FEATURE_GLOBS,
      excludedFiles: SCHEMA_FILES,
      rules: {
        'no-restricted-syntax': [
          'error',
          // Class restrictions — same as MODULE_GLOBS. Re-declared because
          // eslint replaces (rather than merges) rule values across overrides.
          { selector: 'ClassDeclaration', message: 'Use top-level functions, not classes (see ARCHITECTURE.md).' },
          { selector: 'ClassExpression',  message: 'Use top-level functions, not classes (see ARCHITECTURE.md).' },
          // The strict feature-file additions:
          {
            selector: 'Program > VariableDeclaration',
            message: 'No module-level variables in feature files. Use `function name(...) {…}` for behavior; inline literals at use sites; thread shared values through parameters; registries belong in @foundry/server. See ARCHITECTURE.md.',
          },
          {
            selector: 'Program > TSInterfaceDeclaration',
            message: 'Interface declarations belong in schema.ts (one shape file per module).',
          },
          {
            selector: 'Program > TSTypeAliasDeclaration',
            message: 'Type aliases belong in schema.ts (one shape file per module).',
          },
        ],
        // Zod restriction is merged into the per-module
        // cardinalRuleOverrides above so cardinal paths and the zod
        // pattern share one rule config (eslint last-wins on rule
        // values; can't split them safely).
      },
    },

    {
      files: TEST_GLOBS,
      // Tests live outside each package's tsconfig `include` (which is
      // just src/), so type-aware parsing fails on them. Disable the
      // project lookup for tests; we keep syntactic lint, drop the
      // shape rules that hurt test readability.
      parserOptions: { project: false },
      rules: {
        'max-lines-per-function': 'off',
        'max-depth': 'off',
        'no-restricted-syntax': 'off',
        'no-restricted-imports': 'off',
        '@typescript-eslint/no-restricted-imports': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
      },
    },

    // ── server (composition root) ──────────────────────────────────
    // Server owns wiring (registries, lifecycle intervals, env reads).
    // The strict feature-file rules above don't reach here — server is
    // not in LOGIC_FEATURE_GLOBS. This override is just documentation
    // that the carve-out is intentional.
    {
      files: ['server/src/**/*.ts'],
      rules: {
        // No additional restrictions today. If module-level state in
        // server starts to feel sprawling, future rules here can scope
        // it (e.g. allow only inside explicit wire-*.ts files).
      },
    },
  ],
}
