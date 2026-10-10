import "server-only";
import { calculateBeta } from "@/lib/calculations";
import { betaCacheAction, betaRefreshFailure, isBetaStale } from "@/lib/beta-policy";
import { marketDataProvider } from "@/lib/market-provider";
import { isQuoteFresh } from "@/lib/quote-policy";
import { getAdminClient } from "@/lib/supabase";
import type { BetaReading, PriceRow, QuoteReading, StudyDefinition } from "@/lib/types";

const DAY_MS = 86_400_000;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateOffset(value: string, days: number) {
  return isoDate(new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS));
}

function todayNewYork() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function mapPrice(row: Record<string, unknown>): PriceRow {
  return {
    symbol: String(row.symbol),
    date: String(row.price_date),
    rawClose: Number(row.raw_close),
    adjustedClose: Number(row.adjusted_close),
  };
}

async function readPrices(symbols: string[], start: string, end: string) {
  const client = getAdminClient();
  if (!client) return [];
  const rows: PriceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("fastevent_prices")
      .select("symbol,price_date,raw_close,adjusted_close")
      .in("symbol", symbols)
      .gte("price_date", start)
      .lte("price_date", end)
      .order("price_date")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []).map((row) => mapPrice(row)));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function coverageIsFresh(symbol: string, start: string, end: string) {
  const client = getAdminClient();
  if (!client) return false;
  const hours = Number(process.env.FASTEVENT_PRICE_CACHE_HOURS ?? 24);
  const freshAfter = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await client.from("fastevent_price_fetches")
    .select("id")
    .eq("symbol", symbol)
    .eq("status", "success")
    .lte("requested_start", start)
    .gte("requested_end", end)
    .gte("completed_at", freshAfter)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function persistFetch(symbol: string, start: string, end: string, rows: PriceRow[], errorMessage?: string) {
  const client = getAdminClient();
  if (!client) return;
  const provider = marketDataProvider();
  if (rows.length) {
    for (let index = 0; index < rows.length; index += 500) {
      const chunk = rows.slice(index, index + 500).map((row) => ({
        symbol: row.symbol,
        price_date: row.date,
        raw_close: row.rawClose,
        adjusted_close: row.adjustedClose,
        provider: provider.name,
        fetched_at: new Date().toISOString(),
      }));
      const { error } = await client.from("fastevent_prices").upsert(chunk, { onConflict: "symbol,price_date" });
      if (error) throw error;
    }
  }
  const { error } = await client.from("fastevent_price_fetches").insert({
    symbol,
    requested_start: start,
    requested_end: end,
    provider: provider.name,
    status: errorMessage ? "failed" : "success",
    row_count: rows.length,
    error_message: errorMessage ?? null,
    completed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function ensurePriceCoverage(symbols: string[], start: string, end: string) {
  const provider = marketDataProvider();
  const warnings: string[] = [];
  const directRows: PriceRow[] = [];
  for (const symbol of symbols) {
    if (await coverageIsFresh(symbol, start, end)) continue;
    try {
      const rows = await provider.fetchDaily(symbol, start, end);
      if (!rows.length) throw new Error(`No EOD prices returned for ${symbol}.`);
      directRows.push(...rows);
      await persistFetch(symbol, start, end, rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await persistFetch(symbol, start, end, [], message).catch(() => undefined);
      const cached = await readPrices([symbol], start, end);
      if (!cached.length) throw error;
      warnings.push(`${symbol} refresh failed; using cached prices. ${message}`);
    }
  }
  const storedRows = await readPrices(symbols, start, end);
  if (!getAdminClient()) return { rows: directRows, warnings: [...warnings, "Supabase is not configured; market data is not persisted."] };
  return { rows: storedRows, warnings };
}

function mapBeta(row: Record<string, unknown>): BetaReading {
  return {
    instrument: String(row.instrument_symbol),
    benchmark: String(row.benchmark_symbol),
    beta: Number(row.beta),
    asOfDate: String(row.as_of_date),
    alignedObservations: Number(row.aligned_observations),
    coverageRatio: Number(row.coverage_ratio),
    calculationVersion: String(row.calculation_version),
    calculatedAt: String(row.calculated_at),
    stale: isBetaStale(String(row.calculated_at)),
  };
}

async function readBeta(instrument: string, benchmark: string) {
  const client = getAdminClient();
  if (!client) return null;
  const { data, error } = await client.from("fastevent_betas")
    .select("*")
    .eq("instrument_symbol", instrument)
    .eq("benchmark_symbol", benchmark)
    .maybeSingle();
  if (error) throw error;
  return data ? mapBeta(data) : null;
}

export async function resolveBeta(definition: StudyDefinition, checkBeta: boolean) {
  const warnings: string[] = [];
  const existing = await readBeta(definition.instrument, definition.benchmark);
  const cacheAction = betaCacheAction(existing?.calculatedAt ?? null, checkBeta);
  if (cacheAction === "reuse") return { beta: existing, warnings };
  if (cacheAction === "unavailable") return { beta: null, warnings: ["No cached beta is available. Load or create the study to calculate it."] };

  const asOfRequest = todayNewYork();
  const start = dateOffset(asOfRequest, -380);
  try {
    const coverage = await ensurePriceCoverage([definition.instrument, definition.benchmark], start, asOfRequest);
    warnings.push(...coverage.warnings);
    const datesBySymbol = new Map<string, Set<string>>();
    for (const row of coverage.rows) {
      if (!datesBySymbol.has(row.symbol)) datesBySymbol.set(row.symbol, new Set());
      datesBySymbol.get(row.symbol)!.add(row.date);
    }
    const instrumentDates = datesBySymbol.get(definition.instrument) ?? new Set();
    const benchmarkDates = datesBySymbol.get(definition.benchmark) ?? new Set();
    const asOfDate = [...instrumentDates].filter((date) => benchmarkDates.has(date)).sort().at(-1);
    if (!asOfDate) throw new Error("No aligned prices are available for beta estimation.");
    const result = calculateBeta(coverage.rows, definition.instrument, definition.benchmark, asOfDate);
    if (result.beta === null) throw new Error(`Beta unavailable: ${result.reason}.`);
    const calculatedAt = new Date().toISOString();
    const calculationVersion = process.env.FASTEVENT_CALCULATION_VERSION ?? "v1";
    const next: BetaReading = {
      instrument: definition.instrument,
      benchmark: definition.benchmark,
      beta: result.beta,
      asOfDate,
      alignedObservations: result.observations,
      coverageRatio: result.coverageRatio,
      calculationVersion,
      calculatedAt,
      stale: false,
    };
    const client = getAdminClient();
    if (client) {
      const { error } = await client.from("fastevent_betas").upsert({
        instrument_symbol: next.instrument,
        benchmark_symbol: next.benchmark,
        beta: next.beta,
        as_of_date: next.asOfDate,
        aligned_observations: next.alignedObservations,
        coverage_ratio: next.coverageRatio,
        calculation_version: next.calculationVersion,
        calculated_at: next.calculatedAt,
      }, { onConflict: "instrument_symbol,benchmark_symbol" });
      if (error) throw error;
    }
    return { beta: next, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return betaRefreshFailure(existing, message);
  }
}

function mapQuote(row: Record<string, unknown>): QuoteReading {
  return {
    symbol: String(row.symbol),
    price: Number(row.price),
    quoteAsOf: String(row.quote_as_of),
    marketState: row.market_state ? String(row.market_state) : null,
    provider: String(row.provider),
    cached: true,
  };
}

export async function latestQuote(symbol: string) {
  const client = getAdminClient();
  const ttl = Number(process.env.FASTEVENT_QUOTE_CACHE_SECONDS ?? 60) * 1000;
  if (client) {
    const { data, error } = await client.from("fastevent_quote_cache").select("*").eq("symbol", symbol).maybeSingle();
    if (error) throw error;
    if (data && isQuoteFresh(String(data.fetched_at), ttl)) return mapQuote(data);
  }
  const quote = await marketDataProvider().fetchQuote(symbol);
  if (client) {
    const { error } = await client.from("fastevent_quote_cache").upsert({
      symbol: quote.symbol,
      price: quote.price,
      quote_as_of: quote.quoteAsOf,
      market_state: quote.marketState,
      provider: quote.provider,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "symbol" });
    if (error) throw error;
  }
  return quote;
}

export function eventPriceRange(definition: StudyDefinition) {
  const dates = [definition.currentEvent.day0, ...definition.historicalEvents.map((event) => event.day0)];
  const earliest = dates.sort()[0];
  const latest = [definition.asOf, ...dates.map((date) => dateOffset(date, 130))].sort().at(-1)!;
  return { start: dateOffset(earliest, -45), end: latest > definition.asOf ? definition.asOf : latest };
}
