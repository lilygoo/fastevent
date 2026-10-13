import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("FastEvent application code does not query shared project tables", () => {
  const roots = ["app", "lib", "scripts"];
  const forbidden = /\b(daily_prices|daily_price_versions|security_beta_metrics)\b/;
  const files: string[] = [];
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  }
  roots.forEach(visit);
  const offenders = files.filter((file) => forbidden.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("event beta persistence is concurrency-safe for each pair, cutoff, and version", () => {
  const migration = fs.readFileSync("supabase/migrations/202610120001_normalized_runs.sql", "utf8");
  const marketData = fs.readFileSync("lib/market-data.ts", "utf8");
  assert.match(migration, /primary key \(instrument_symbol, benchmark_symbol, estimation_cutoff, calculation_version\)/);
  assert.match(marketData, /onConflict: "instrument_symbol,benchmark_symbol,estimation_cutoff,calculation_version"/);
});

test("saved-study runs persist normalized events and points atomically with idempotent fingerprints", () => {
  const migration = fs.readFileSync("supabase/migrations/202610120001_normalized_runs.sql", "utf8");
  const persistence = fs.readFileSync("lib/study-results.ts", "utf8");
  assert.match(migration, /create table if not exists public\.fastevent_study_runs/);
  assert.match(migration, /create table if not exists public\.fastevent_study_return_points/);
  assert.match(migration, /create or replace function public\.fastevent_store_study_run/);
  assert.match(migration, /unique \(study_id, study_revision, input_fingerprint\)/);
  assert.match(persistence, /fastevent_store_study_run/);
});

test("new application code does not read or write legacy beta or result tables", () => {
  const sources = ["lib/market-data.ts", "lib/event-study-service.ts", "lib/study-results.ts"]
    .map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(sources, /fastevent_betas/);
  assert.doesNotMatch(sources, /fastevent_study_results/);
});
