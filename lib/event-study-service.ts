import "server-only";
import { alignEventSeries, calculateDistribution, calculateOutcomes } from "@/lib/calculations";
import { ensurePriceCoverage, eventPriceRange, latestQuote, resolveBeta } from "@/lib/market-data";
import { marketDataProvider } from "@/lib/market-provider";
import { persistStudyResult } from "@/lib/study-results";
import type { EventStudyResponse, PriceRow, StudyDefinition } from "@/lib/types";

function quoteDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function appendLatest(rows: PriceRow[], symbol: string, price: number, date: string) {
  const symbolRows = rows.filter((row) => row.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date));
  const prior = symbolRows.at(-1);
  if (!prior || date < prior.date) return rows;
  const adjustedPrice = price * (prior.adjustedClose / prior.rawClose);
  return [
    ...rows.filter((row) => !(row.symbol === symbol && row.date === date)),
    { symbol, date, rawClose: price, adjustedClose: adjustedPrice },
  ];
}

export async function runEventStudy(
  definition: StudyDefinition,
  checkBeta: boolean,
  includeLatest: boolean,
  target?: { studyId: string; studyRevision: number },
): Promise<EventStudyResponse> {
  const range = eventPriceRange(definition);
  const coverage = await ensurePriceCoverage([definition.instrument, definition.benchmark], range.start, range.end);
  const betaResult = await resolveBeta(definition, checkBeta);
  const warnings = [...coverage.warnings, ...betaResult.warnings];
  let rows = coverage.rows;
  let quoteAsOf: string | null = null;
  let priceStatus: "eod" | "latest" = "eod";

  if (includeLatest && definition.priceMode === "latest") {
    try {
      const [instrumentQuote, benchmarkQuote] = await Promise.all([
        latestQuote(definition.instrument),
        latestQuote(definition.benchmark),
      ]);
      const date = quoteDate(instrumentQuote.quoteAsOf);
      if (date <= definition.asOf) {
        rows = appendLatest(rows, definition.instrument, instrumentQuote.price, date);
        rows = appendLatest(rows, definition.benchmark, benchmarkQuote.price, quoteDate(benchmarkQuote.quoteAsOf));
        quoteAsOf = instrumentQuote.quoteAsOf;
        priceStatus = "latest";
      } else {
        warnings.push("Latest quote is after the study as-of date; EOD data remains active.");
      }
    } catch (error) {
      warnings.push(`Latest quote failed; showing EOD. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const historical = definition.historicalEvents.map((event) => alignEventSeries(definition, event, rows, betaResult.beta, false));
  const current = alignEventSeries(definition, definition.currentEvent, rows, betaResult.beta, true);
  const series = [...historical, current];
  const dataAsOf = current.points.at(-1)?.date ?? definition.asOf;
  const priceStale = dataAsOf < definition.asOf;
  if (priceStale) warnings.push(`Stale price: latest available price is ${dataAsOf} (study as of ${definition.asOf}).`);
  const distributions = {
    raw: calculateDistribution(series, "raw"),
    excess: calculateDistribution(series, "excess"),
    beta: calculateDistribution(series, "beta"),
  };
  const outcomesByLens = {
    raw: calculateOutcomes(series, "raw"),
    excess: calculateOutcomes(series, "excess"),
    beta: calculateOutcomes(series, "beta"),
  };
  const result: EventStudyResponse = {
    definition,
    beta: betaResult.beta,
    betaAvailable: Boolean(betaResult.beta),
    series,
    distribution: distributions[definition.lens],
    distributions,
    outcomes: outcomesByLens[definition.lens],
    outcomesByLens,
    dataAsOf,
    priceStale,
    priceStatus,
    quoteAsOf,
    provenance: {
      marketDataProvider: marketDataProvider().name,
      priceBasis: "adjusted_close",
      betaMethod: "ols_with_intercept",
      betaWindowCalendarDays: 365,
      betaMinimumObservations: 200,
      betaMinimumCoverage: 0.9,
      calculationVersion: process.env.FASTEVENT_CALCULATION_VERSION ?? "v1",
    },
    warnings: [...new Set(warnings)],
  };
  if (target) {
    try {
      await persistStudyResult(target.studyId, target.studyRevision, result);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? JSON.stringify(error)
          : String(error);
      result.warnings.push(`Calculated returns could not be saved. ${message}`);
    }
  }
  return result;
}
