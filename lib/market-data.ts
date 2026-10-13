import "server-only";
import { calculateBeta } from "@/lib/calculations";
import { isDailyBarFinal, todayEastern } from "@/lib/dates";
import { marketDataProvider } from "@/lib/market-provider";
import { isQuoteFresh } from "@/lib/quote-policy";
import { getAdminClient } from "@/lib/supabase";
import type { BetaReading, PriceRow, QuoteReading, StudyDefinition, StudyEvent } from "@/lib/types";

const DAY_MS = 86_400_000;
export const CANONICAL_PRE_DAYS = 10;
export const CANONICAL_POST_DAYS = 50;

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
export function dateOffset(value: string, days: number) {
  return isoDate(new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS));
}

function mapPrice(row: Record<string, unknown>): PriceRow {
  return {
    symbol: String(row.symbol), date: String(row.price_date), rawClose: Number(row.raw_close),
    adjustedClose: Number(row.adjusted_close), isFinal: row.is_final === undefined ? true : Boolean(row.is_final), source: "eod",
  };
}

export async function readPrices(symbols: string[], start: string, end: string) {
  const client = getAdminClient();
  if (!client) return [];
  const rows: PriceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("fastevent_prices")
      .select("symbol,price_date,raw_close,adjusted_close,is_final").in("symbol", symbols)
      .gte("price_date", start).lte("price_date", end).order("price_date").range(from, from + 999);
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
  const { data, error } = await client.from("fastevent_price_fetches").select("id")
    .eq("symbol", symbol).eq("status", "success").lte("requested_start", start).gte("requested_end", end)
    .gte("completed_at", freshAfter).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function persistFetch(symbol: string, start: string, end: string, rows: PriceRow[], now: Date, errorMessage?: string) {
  const client = getAdminClient();
  if (!client) return;
  const provider = marketDataProvider();
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500).map((row) => ({
      symbol: row.symbol, price_date: row.date, raw_close: row.rawClose, adjusted_close: row.adjustedClose,
      is_final: isDailyBarFinal(row.date, now), provider: provider.name, fetched_at: now.toISOString(),
    }));
    const { error } = await client.from("fastevent_prices").upsert(chunk, { onConflict: "symbol,price_date" });
    if (error) throw error;
  }
  const { error } = await client.from("fastevent_price_fetches").insert({
    symbol, requested_start: start, requested_end: end, provider: provider.name,
    status: errorMessage ? "failed" : "success", row_count: rows.length,
    error_message: errorMessage ?? null, completed_at: now.toISOString(),
  });
  if (error) throw error;
}

export async function ensurePriceCoverage(symbols: string[], start: string, end: string, options: { force?: boolean; now?: Date } = {}) {
  const provider = marketDataProvider();
  const warnings: string[] = [];
  const directRows: PriceRow[] = [];
  const now = options.now ?? new Date();
  for (const symbol of symbols) {
    let fresh = !options.force && await coverageIsFresh(symbol, start, end);
    const today = todayEastern(now);
    if (fresh && end >= today && isDailyBarFinal(today, now)) {
      const currentDay = await readPrices([symbol], today, today);
      fresh = currentDay.some((row) => row.isFinal !== false);
    }
    if (fresh) continue;
    try {
      const rows = (await provider.fetchDaily(symbol, start, end)).map((row) => ({
        ...row, isFinal: isDailyBarFinal(row.date, now), source: "eod" as const,
      }));
      if (!rows.length) throw new Error(`No EOD prices returned for ${symbol}.`);
      directRows.push(...rows);
      await persistFetch(symbol, start, end, rows, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await persistFetch(symbol, start, end, [], now, message).catch(() => undefined);
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
    instrument: String(row.instrument_symbol), benchmark: String(row.benchmark_symbol), beta: Number(row.beta),
    asOfDate: String(row.estimation_cutoff), alignedObservations: Number(row.aligned_observations),
    coverageRatio: Number(row.coverage_ratio), calculationVersion: String(row.calculation_version),
    calculatedAt: String(row.calculated_at), stale: false,
  };
}

function eventBetaCutoff(definition: StudyDefinition, event: StudyEvent, rows: PriceRow[]) {
  const instrumentDates = new Set(rows.filter((row) => row.symbol === definition.instrument).map((row) => row.date));
  const jointDates = [...new Set(rows.filter((row) => row.symbol === definition.benchmark && instrumentDates.has(row.date)).map((row) => row.date))].sort();
  const day0Index = jointDates.findIndex((date) => date >= event.day0);
  if (day0Index < 0) throw new Error(`No joint session is available on or after ${event.day0}.`);
  const cutoffIndex = day0Index - CANONICAL_PRE_DAYS - 1;
  if (cutoffIndex < 0) throw new Error(`Not enough pre-event sessions to estimate beta for ${event.label}.`);
  return jointDates[cutoffIndex];
}

export async function resolveEventBeta(definition: StudyDefinition, event: StudyEvent, rows: PriceRow[]) {
  const calculationVersion = process.env.FASTEVENT_CALCULATION_VERSION ?? "v2-daily-car";
  const estimationCutoff = eventBetaCutoff(definition, event, rows);
  const client = getAdminClient();
  if (client) {
    const { data, error } = await client.from("fastevent_beta_estimates").select("*")
      .eq("instrument_symbol", definition.instrument).eq("benchmark_symbol", definition.benchmark)
      .eq("estimation_cutoff", estimationCutoff).eq("calculation_version", calculationVersion).maybeSingle();
    if (error) throw error;
    if (data) return { beta: mapBeta(data), warnings: [] as string[] };
  }
  const estimate = calculateBeta(rows, definition.instrument, definition.benchmark, estimationCutoff);
  if (estimate.beta === null) return { beta: null, warnings: [`Beta unavailable for ${event.label}: ${estimate.reason}.`] };
  const beta: BetaReading = {
    instrument: definition.instrument, benchmark: definition.benchmark, beta: estimate.beta,
    asOfDate: estimationCutoff, alignedObservations: estimate.observations, coverageRatio: estimate.coverageRatio,
    calculationVersion, calculatedAt: new Date().toISOString(), stale: false,
  };
  if (client) {
    const { error } = await client.from("fastevent_beta_estimates").upsert({
      instrument_symbol: beta.instrument, benchmark_symbol: beta.benchmark, estimation_cutoff: beta.asOfDate,
      beta: beta.beta, aligned_observations: beta.alignedObservations, coverage_ratio: beta.coverageRatio,
      calculation_version: beta.calculationVersion, calculated_at: beta.calculatedAt,
    }, { onConflict: "instrument_symbol,benchmark_symbol,estimation_cutoff,calculation_version" });
    if (error) throw error;
  }
  return { beta, warnings: [] as string[] };
}

function mapQuote(row: Record<string, unknown>): QuoteReading {
  return { symbol: String(row.symbol), price: Number(row.price), quoteAsOf: String(row.quote_as_of),
    marketState: row.market_state ? String(row.market_state) : null, provider: String(row.provider), cached: true };
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
    const { error } = await client.from("fastevent_quote_cache").upsert({ symbol: quote.symbol, price: quote.price,
      quote_as_of: quote.quoteAsOf, market_state: quote.marketState, provider: quote.provider, fetched_at: new Date().toISOString() },
    { onConflict: "symbol" });
    if (error) throw error;
  }
  return quote;
}

export function eventPriceRange(definition: StudyDefinition) {
  const dates = [definition.currentEvent.day0, ...definition.historicalEvents.map((event) => event.day0)].sort();
  return { start: dateOffset(dates[0], -440), end: definition.asOf };
}
