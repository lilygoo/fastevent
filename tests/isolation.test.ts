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

test("beta persistence is concurrency-safe for each ordered pair", () => {
  const migration = fs.readFileSync("supabase/migrations/202610090001_fastevent.sql", "utf8");
  const marketData = fs.readFileSync("lib/market-data.ts", "utf8");
  assert.match(migration, /primary key \(instrument_symbol, benchmark_symbol\)/);
  assert.match(marketData, /onConflict: "instrument_symbol,benchmark_symbol"/);
});

test("saved-study results persist one complete three-lens snapshot per study", () => {
  const migration = fs.readFileSync("supabase/migrations/202610090002_fastevent_study_results.sql", "utf8");
  const persistence = fs.readFileSync("lib/study-results.ts", "utf8");
  assert.match(migration, /study_id uuid primary key references public\.fastevent_studies/);
  assert.match(migration, /result jsonb not null/);
  assert.match(persistence, /fastevent_study_results/);
  assert.match(persistence, /onConflict: "study_id"/);
});
