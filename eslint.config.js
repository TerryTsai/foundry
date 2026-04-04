// @ts-check
import js from "@eslint/js";

const STORAGE_INTERNALS = [
  "drizzle-orm",
  "drizzle-orm/*",
  "better-sqlite3",
  "node:crypto",
];

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: STORAGE_INTERNALS.map((name) => ({
            group: [name],
            message:
              "Storage internals must not be imported outside src/repository/impl/. Use IFoundryRepository instead.",
          })),
        },
      ],
    },
  },
  {
    // Allow storage internals only inside the repository impl
    files: ["src/repository/impl/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
