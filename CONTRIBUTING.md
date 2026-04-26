# Contributing

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before adding code. It is authoritative for module boundaries, file layout, code style, and the conventions every change must follow. The rules are enforced mechanically — `npm run check` runs the lint pass, which carries the cardinal-rule, function-shape, and no-class checks.

## Before opening a change

```sh
npm install        # if package.json changed
npm run check      # lint (cardinal rule + function shape + no classes)
npx tsc -b         # type-check the workspace
```

If a change touches a logic module, also run that module's tests:

```sh
cd packages/<module> && npx vitest run
```

## Adding a new module

Copy an existing package as a skeleton (e.g. `cp -r packages/billing packages/<name>`), rename it inside `package.json`, update `src/index.ts`, then:

1. Add the package's tsconfig reference to the root `tsconfig.json`.
2. Declare its dependencies in `package.json`.
3. If it's a logic module, add it to `LOGIC_MODULES` in `.eslintrc.cjs` so the cardinal rule covers it.

## What you can rely on

- **Cross-module imports**: logic modules cannot import other logic modules; non-{crud,analytics} can only type-import `@foundry/db`. Enforced by ESLint `no-restricted-imports` per logic-module package in `.eslintrc.cjs`.
- **No classes in logic modules**: enforced by ESLint `no-restricted-syntax`.
- **Function size**: 20-line cap, depth ≤ 2. Enforced by ESLint `max-lines-per-function` and `max-depth`.

## What's grandfathered

Packages migrated during Phase 4 carry `// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7+` comments on functions that exceed the target. Don't add new disables to new code — those should fail review.

The migration-window settings will tighten when internal throw-AppError patterns get converted to native Result. Until then, mature legacy code stays as-is.

## Commits and pushes

Direct commits to `main` are normal — this is a single-developer workflow. Larger changes can use feature branches (`foundry/<name>`) but aren't required.
