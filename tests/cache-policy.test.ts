import assert from "node:assert/strict";
import test from "node:test";
import { isQuoteFresh } from "../lib/quote-policy";

test("quote cache is reused through its 60-second TTL", () => {
  const fetchedAt = "2026-10-09T12:00:00.000Z";
  const fetchedMs = Date.parse(fetchedAt);
  assert.equal(isQuoteFresh(fetchedAt, 60_000, fetchedMs + 60_000), true);
  assert.equal(isQuoteFresh(fetchedAt, 60_000, fetchedMs + 60_001), false);
});
