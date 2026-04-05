// One-time script to seed the Snapquery project.
// Run: npx tsx src/scripts/seed-project.ts
// Idempotent — skips if a project with slug "snapquery" already exists.

import { config as loadEnv } from "dotenv";
loadEnv();

import { openRepository, repositoryConfigFromEnv } from "../repository/index.js";
import { seedCapabilities } from "../capabilities/seed.js";

async function main() {
  const config = repositoryConfigFromEnv();
  const repo = await openRepository(config);

  await seedCapabilities(repo);

  // Check if already seeded
  const existing = repo.projects.list().find((p) => p.slug === "snapquery");
  if (existing) {
    console.log(`[seed-project] Snapquery already exists: ${existing.id}`);
    await repo.close();
    return;
  }

  const project = repo.projects.create({
    name: "Snapquery",
    slug: "snapquery",
    tagline: "Fast, drag-and-drop data exploration with SQL for anyone",
    problem:
      "Data analysts and curious non-engineers need to quickly explore CSV, Parquet, and other data files without installing tools or writing boilerplate. Existing tools are too heavy (Excel, Pandas) or too bare (sqlite3 CLI).",
    user:
      "Developers, analysts, and data-curious founders who work with structured data files and want answers fast — without context-switching to a full BI tool.",
    mvp:
      "Web app where users drag-and-drop a CSV/Parquet file, see a data table immediately, can filter/sort columns, and write SQL queries powered by DuckDB WASM in the browser. No sign-up. No server-side query execution.",
    constraints:
      "Must work entirely in the browser (no server query execution). DuckDB WASM handles all computation client-side. Fast load time — under 3 seconds to first table view. Mobile-friendly.",
    existing:
      "Prior implementation exists and has been used in production. This is a clean reimplementation — the previous codebase is not being carried forward.",
    assumptions: [
      "DuckDB WASM v1.x runs reliably in modern browsers (Chrome, Firefox, Safari)",
      "File size limit of 500MB is acceptable for v1",
      "No auth needed for v1 — files are processed client-side only",
      "React + Vite is the right stack for the frontend",
      "Deployment target is Vercel or similar static host",
    ],
  });

  console.log(`[seed-project] Created Snapquery project: ${project.id}`);

  // Seed GitHub and Vercel capabilities for this project
  const githubDef = repo.capabilities
    .listDefinitions()
    .find((c) => c.name === "GitHub");
  const vercelDef = repo.capabilities
    .listDefinitions()
    .find((c) => c.name === "Vercel");

  if (githubDef) {
    repo.capabilities.addToProject(project.id, githubDef.id);
    console.log("[seed-project] Added GitHub capability (pending configuration)");
  }
  if (vercelDef) {
    repo.capabilities.addToProject(project.id, vercelDef.id);
    console.log("[seed-project] Added Vercel capability (pending configuration)");
  }

  await repo.close();
  console.log("[seed-project] Done");
}

main().catch((err) => {
  console.error("[seed-project] Fatal:", err);
  process.exit(1);
});
