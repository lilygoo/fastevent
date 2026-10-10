import assert from "node:assert/strict";
import test from "node:test";
import { YahooMarketDataProvider } from "../lib/market-provider";

test("Yahoo adapter maps raw and adjusted closes behind the provider interface", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [Date.parse("2026-10-08T13:30:00Z") / 1000],
        indicators: { quote: [{ close: [101] }], adjclose: [{ adjclose: [99] }] },
      }],
      error: null,
    },
  }), { status: 200 });
  const rows = await new YahooMarketDataProvider().fetchDaily("SOXX", "2026-10-08", "2026-10-08");
  assert.deepEqual(rows, [{ symbol: "SOXX", date: "2026-10-08", rawClose: 101, adjustedClose: 99 }]);
});

test("Yahoo adapter exposes provider failures", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(
    new YahooMarketDataProvider().fetchDaily("SOXX", "2026-10-08", "2026-10-08"),
    /HTTP 503/,
  );
});
