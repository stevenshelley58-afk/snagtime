import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeSourceText(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function sha1Normalized(value) {
  return createHash("sha1").update(normalizeSourceText(value), "utf8").digest("hex");
}

const generated = ["prisma/postgresql/schema.prisma"];
const baseline = "prisma/postgresql/migrations/202608220100_production_baseline/migration.sql";
const immutableBaselineSha = "d7431f25291ddfe65a854a81ec80c489e487326c";

export function verifyGeneratedDrift() {
  if (sha1Normalized(readFileSync(baseline, "utf8")) !== immutableBaselineSha) throw new Error("Immutable PostgreSQL baseline was edited.");
  const digest = () => createHash("sha256").update(generated.map((path) => `${path}\0${normalizeSourceText(readFileSync(path, "utf8"))}\n`).join(""), "utf8").digest("hex");
  const before = digest();
  for (const script of ["scripts/generate-postgres-schema.mjs"]) {
    const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
    if (result.status !== 0) return result.status ?? 1;
  }
  if (digest() !== before) throw new Error("Generated PostgreSQL schema or baseline drifted from its committed source.");
  console.log("Generated PostgreSQL schema and baseline are byte-identical to source transforms.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = verifyGeneratedDrift();
