import "server-only";
import type { PriceRow, QuoteReading } from "@/lib/types";

export interface MarketDataProvider {
  readonly name: string;
  fetchDaily(symbol: string, start: string, end: string): Promise<PriceRow[]>;
  fetchQuote(symbol: string): Promise<QuoteReading>;
}

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        marketState?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

function unixSeconds(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

async function yahooChart(symbol: string, query: URLSearchParams) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "FastEvent/0.1 private-research" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Yahoo returned HTTP ${response.status} for ${symbol}.`);
  const payload = await response.json() as YahooChart;
  const error = payload.chart?.error?.description;
  if (error) throw new Error(error);
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo returned no data for ${symbol}.`);
  return result;
}

export class YahooMarketDataProvider implements MarketDataProvider {
  readonly name = "yahoo";

  async fetchDaily(symbol: string, start: string, end: string) {
    const exclusiveEnd = new Date(`${end}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    const result = await yahooChart(symbol, new URLSearchParams({
      period1: String(unixSeconds(start)),
      period2: String(Math.floor(exclusiveEnd.getTime() / 1000)),
      interval: "1d",
      events: "history",
      includeAdjustedClose: "true",
    }));
    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    return timestamps.flatMap((timestamp, index): PriceRow[] => {
      const rawClose = closes[index];
      const adjustedClose = adjusted[index];
      if (rawClose == null || adjustedClose == null || rawClose <= 0 || adjustedClose <= 0) return [];
      return [{
        symbol,
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        rawClose,
        adjustedClose,
      }];
    });
  }

  async fetchQuote(symbol: string): Promise<QuoteReading> {
    const result = await yahooChart(symbol, new URLSearchParams({ interval: "1m", range: "1d" }));
    const timestamp = result.meta?.regularMarketTime;
    const price = result.meta?.regularMarketPrice;
    if (!timestamp || !price || price <= 0) throw new Error(`Yahoo returned no latest quote for ${symbol}.`);
    return {
      symbol,
      price,
      quoteAsOf: new Date(timestamp * 1000).toISOString(),
      marketState: result.meta?.marketState ?? null,
      provider: this.name,
      cached: false,
    };
  }
}

export function marketDataProvider(): MarketDataProvider {
  const provider = process.env.MARKET_DATA_PROVIDER ?? "yahoo";
  if (provider !== "yahoo") throw new Error(`Unsupported market data provider: ${provider}.`);
  return new YahooMarketDataProvider();
}
