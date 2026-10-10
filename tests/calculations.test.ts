import assert from "node:assert/strict";
import test from "node:test";
import { alignEventSeries, calculateBeta, calculateDistribution, calculateOutcomes } from "../lib/calculations";
import { initialStudy } from "../lib/default-study";
import type { BetaReading, PriceRow } from "../lib/types";

function weekdayRows(start: string, count: number): PriceRow[] {
  const rows: PriceRow[] = [];
  let date = new Date(`${start}T00:00:00Z`);
  let instrument = 100;
  let benchmark = 100;
  for (let index = 0; index < count;) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      const benchmarkReturn = 0.001 + Math.sin(index / 11) * 0.003;
      const instrumentReturn = 0.0002 + 2 * benchmarkReturn;
      benchmark *= 1 + benchmarkReturn;
      instrument *= 1 + instrumentReturn;
      const iso = date.toISOString().slice(0, 10);
      rows.push({ symbol: "SOXX", date: iso, rawClose: instrument * 1.02, adjustedClose: instrument });
      rows.push({ symbol: "QQQ", date: iso, rawClose: benchmark * 1.02, adjustedClose: benchmark });
      index += 1;
    }
    date = new Date(date.getTime() + 86_400_000);
  }
  return rows;
}

test("OLS beta uses adjusted-close returns", () => {
  const rows = weekdayRows("2025-10-01", 270);
  const result = calculateBeta(rows, "SOXX", "QQQ", rows.at(-1)!.date, { minimumObservations: 100 });
  assert.ok(result.beta !== null);
  assert.ok(Math.abs(result.beta! - 2) < 0.02);
});

test("event alignment maps a weekend Day 0 to the next joint session", () => {
  const rows = weekdayRows("2026-08-10", 60);
  const definition = structuredClone(initialStudy);
  definition.currentEvent.day0 = "2026-08-15"; // Saturday
  definition.asOf = "2026-10-09";
  definition.preDays = 2;
  definition.postDays = 5;
  const beta: BetaReading = {
    instrument: "SOXX", benchmark: "QQQ", beta: 2, asOfDate: "2026-10-01",
    alignedObservations: 200, coverageRatio: 1, calculationVersion: "v1",
    calculatedAt: "2026-10-01T00:00:00Z", stale: false,
  };
  const series = alignEventSeries(definition, definition.currentEvent, rows, beta, true);
  assert.equal(series.effectiveDay0, "2026-08-17");
  assert.equal(series.points.find((point) => point.day === 0)?.value, 0);
  assert.equal(series.points[0].day, -2);
});

test("distribution and outcomes use available active event values", () => {
  const rows = weekdayRows("2026-08-10", 60);
  const definition = structuredClone(initialStudy);
  definition.asOf = "2026-10-09";
  definition.lens = "raw";
  const historical = alignEventSeries(definition, definition.historicalEvents[0], rows, null, false);
  const current = alignEventSeries(definition, { ...definition.currentEvent, day0: "2026-08-24" }, rows, null, true);
  assert.ok(calculateDistribution([historical, current]).length > 0);
  assert.equal(calculateOutcomes([historical, current]).length, 2);
});

test("raw, excess, and beta-adjusted paths use cumulative adjusted-close returns", () => {
  const rows: PriceRow[] = [
    { symbol: "SOXX", date: "2026-10-07", rawClose: 50, adjustedClose: 100 },
    { symbol: "QQQ", date: "2026-10-07", rawClose: 80, adjustedClose: 200 },
    { symbol: "SOXX", date: "2026-10-08", rawClose: 52.5, adjustedClose: 110 },
    { symbol: "QQQ", date: "2026-10-08", rawClose: 81, adjustedClose: 204 },
  ];
  const definition = structuredClone(initialStudy);
  definition.preDays = 0;
  definition.postDays = 5;
  const beta: BetaReading = {
    instrument: "SOXX", benchmark: "QQQ", beta: 2, asOfDate: "2026-10-08",
    alignedObservations: 220, coverageRatio: 1, calculationVersion: "v1",
    calculatedAt: "2026-10-08T22:00:00Z", stale: false,
  };

  definition.lens = "raw";
  assert.ok(Math.abs(alignEventSeries(definition, definition.currentEvent, rows, beta, true).points.at(-1)!.value! - 10) < 1e-10);
  definition.lens = "excess";
  assert.ok(Math.abs(alignEventSeries(definition, definition.currentEvent, rows, beta, true).points.at(-1)!.value! - 8) < 1e-10);
  definition.lens = "beta";
  assert.ok(Math.abs(alignEventSeries(definition, definition.currentEvent, rows, beta, true).points.at(-1)!.value! - 6) < 1e-10);
  assert.equal(alignEventSeries(definition, definition.currentEvent, rows, null, true).points.at(-1)?.value, null);
});

test("beta rejects inadequate observations and inadequate benchmark coverage", () => {
  const tooShort = weekdayRows("2026-01-01", 30);
  const shortResult = calculateBeta(tooShort, "SOXX", "QQQ", tooShort.at(-1)!.date);
  assert.equal(shortResult.beta, null);
  assert.equal(shortResult.reason, "insufficient aligned observations");

  const rows = weekdayRows("2025-10-01", 270).filter((row, index) => row.symbol === "QQQ" || index % 6 !== 0);
  const lowCoverage = calculateBeta(rows, "SOXX", "QQQ", rows.at(-1)!.date, { minimumObservations: 100 });
  assert.equal(lowCoverage.beta, null);
  assert.equal(lowCoverage.reason, "insufficient benchmark coverage");
});
