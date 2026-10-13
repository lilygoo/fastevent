import assert from "node:assert/strict";
import test from "node:test";
import { isDailyBarFinal, isTradingSession } from "../lib/dates";
import { adjustedQuotePrice, validateQuotePair } from "../lib/intraday-policy";
import type { PriceRow, QuoteReading } from "../lib/types";

function quote(symbol: string, quoteAsOf: string): QuoteReading {
  return { symbol, price: 100, quoteAsOf, marketState: null, provider: "test", cached: false };
}

test("the defined session uses Eastern weekday time and ignores provider market state", () => {
  assert.equal(isTradingSession(new Date("2026-10-12T13:29:00Z")), false);
  assert.equal(isTradingSession(new Date("2026-10-12T13:30:00Z")), true);
  assert.equal(isTradingSession(new Date("2026-10-12T20:00:00Z")), true);
  assert.equal(isTradingSession(new Date("2026-10-12T20:01:00Z")), false);
});

test("intraday pair requires same-day, fresh, synchronized positive quotes", () => {
  const now = new Date("2026-10-12T15:00:00Z");
  assert.deepEqual(validateQuotePair(quote("SOXX", "2026-10-12T14:59:10Z"), quote("QQQ", "2026-10-12T14:59:30Z"), now),
    { accepted: true, date: "2026-10-12" });
  assert.equal(validateQuotePair(quote("SOXX", "2026-10-12T14:57:59Z"), quote("QQQ", "2026-10-12T14:59:30Z"), now).accepted, false);
  assert.equal(validateQuotePair(quote("SOXX", "2026-10-09T19:59:00Z"), quote("QQQ", "2026-10-09T19:59:00Z"), now).accepted, false);
  assert.equal(validateQuotePair(quote("SOXX", "2026-10-12T14:57:30Z"), quote("QQQ", "2026-10-12T14:59:40Z"), now).accepted, false);
});

test("a current-day daily bar becomes final only after 4:15 p.m. Eastern", () => {
  assert.equal(isDailyBarFinal("2026-10-12", new Date("2026-10-12T20:14:00Z")), false);
  assert.equal(isDailyBarFinal("2026-10-12", new Date("2026-10-12T20:15:00Z")), true);
  assert.equal(isDailyBarFinal("2026-10-09", new Date("2026-10-12T15:00:00Z")), true);
});

test("latest quotes use the adjustment factor from the latest finalized EOD row", () => {
  const rows: PriceRow[] = [
    { symbol: "SOXX", date: "2026-10-09", rawClose: 100, adjustedClose: 90, isFinal: true },
    { symbol: "SOXX", date: "2026-10-12", rawClose: 110, adjustedClose: 110, isFinal: false },
  ];
  assert.equal(adjustedQuotePrice(rows, "SOXX", 120, "2026-10-12"), 108);
});
