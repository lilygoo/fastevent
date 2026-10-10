import assert from "node:assert/strict";
import test from "node:test";
import { BETA_MAX_AGE_MS, betaCacheAction, betaRefreshFailure, isBetaStale } from "../lib/beta-policy";
import type { BetaReading } from "../lib/types";

test("a beta exactly 30 days old remains fresh", () => {
  const calculatedAt = "2026-09-09T12:00:00.000Z";
  const now = Date.parse(calculatedAt) + BETA_MAX_AGE_MS;
  assert.equal(isBetaStale(calculatedAt, now), false);
  assert.equal(isBetaStale(calculatedAt, now + 1), true);
});

test("failed refresh falls back to stale beta and absence stays unavailable", () => {
  const existing: BetaReading = {
    instrument: "SOXX", benchmark: "QQQ", beta: 1.8, asOfDate: "2026-08-31",
    alignedObservations: 240, coverageRatio: 0.98, calculationVersion: "v1",
    calculatedAt: "2026-08-31T22:00:00Z", stale: true,
  };
  const fallback = betaRefreshFailure(existing, "provider unavailable");
  assert.equal(fallback.beta?.beta, 1.8);
  assert.equal(fallback.beta?.stale, true);
  assert.match(fallback.warnings[0], /using the prior value/);

  const absent = betaRefreshFailure(null, "provider unavailable");
  assert.equal(absent.beta, null);
  assert.match(absent.warnings[0], /calculation failed/);
});

test("beta cache policy refreshes missing and expired records only on trigger", () => {
  const calculatedAt = "2026-09-09T12:00:00.000Z";
  const exactlyThirtyDays = Date.parse(calculatedAt) + BETA_MAX_AGE_MS;
  assert.equal(betaCacheAction(null, false, exactlyThirtyDays), "unavailable");
  assert.equal(betaCacheAction(null, true, exactlyThirtyDays), "refresh");
  assert.equal(betaCacheAction(calculatedAt, true, exactlyThirtyDays), "reuse");
  assert.equal(betaCacheAction(calculatedAt, true, exactlyThirtyDays + 1), "refresh");
  assert.equal(betaCacheAction(calculatedAt, false, exactlyThirtyDays + 1), "reuse");
});
