# Contributing

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before adding code. It is authoritative for module boundaries, file layout, code style, and the conventions every change must follow. The rules are enforced mechanically — `npm run check` runs layout, manifest, and lint validation.

## Before opening a change

```sh
npm install        # if package.json changed
npm run check      # layout + manifest + lint
npx tsc -b         # type-check the workspace
```

If a change touches a logic module, also run that module's tests:

```sh
cd packages/<module> && npx vitest run
```

## Adding a new module

```sh
node scripts/new-module.mjs <name>
```

Generates a package skeleton matching the standard layout (package.json, tsconfig.json, README.md, src/index.ts). Add the package's tsconfig reference to the root `tsconfig.json`, declare its dependencies in `package.json`, and update `.eslintrc.cjs` if it needs to opt into strict rules.

## What you can rely on

- **Cross-module imports**: only `@foundry/model`, `@foundry/client`, `@foundry/db` are importable across logic-module boundaries. Enforced by `scripts/check-manifests.mjs`.
- **No classes in logic modules**: enforced by ESLint `no-restricted-syntax`.
- **File layout**: every package has `package.json`, `tsconfig.json`, `README.md`, and either `src/index.ts` (library) or `src/main.tsx + index.html + vite.config.ts` (SPA). Enforced by `scripts/check-layout.mjs`.
- **Function size**: 10 lines / depth 2 for new-code packages (model, client, billing). 30 lines / depth 3 for legacy migrated logic modules until the internal Result-conversion sweep tightens them.

## What's grandfathered

Packages migrated during Phase 4 carry `// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7+` comments on functions that exceed the target. Don't add new disables to new code — those should fail review.

The migration-window settings will tighten when internal throw-AppError patterns get converted to native Result. Until then, mature legacy code stays as-is.

## Commits and pushes

Direct commits to `main` are normal — this is a single-developer workflow. Larger changes can use feature branches (`foundry/<name>`) but aren't required.
