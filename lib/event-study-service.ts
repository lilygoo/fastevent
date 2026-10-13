import "server-only";
import { alignEventSeries, calculateDistribution, calculateOutcomes } from "@/lib/calculations";
import { adjustedQuotePrice, validateQuotePair } from "@/lib/intraday-policy";
import { ensurePriceCoverage, eventPriceRange, latestQuote, resolveEventBeta } from "@/lib/market-data";
import { marketDataProvider } from "@/lib/market-provider";
import { getStudy } from "@/lib/studies";
import { persistStudyRun } from "@/lib/study-results";
import type { EventStudyResponse, PriceRow, StudyDefinition } from "@/lib/types";

function appendLatest(rows: PriceRow[], symbol: string, price: number, date: string) {
  const adjustedPrice = adjustedQuotePrice(rows, symbol, price, date);
  return [
    ...rows.filter((row) => !(row.symbol === symbol && row.date === date)),
    { symbol, date, rawClose: price, adjustedClose: adjustedPrice, isFinal: false, source: "latest" as const },
  ];
}

export async function runEventStudy(
  requestedDefinition: StudyDefinition,
  _checkBeta: boolean,
  includeLatest: boolean,
  target?: { studyId: string; studyRevision: number },
  options: { forcePriceRefresh?: boolean; now?: Date } = {},
): Promise<EventStudyResponse> {
  let definition = requestedDefinition;
  if (target) {
    const saved = await getStudy(target.studyId);
    if (!saved || saved.revision !== target.studyRevision) throw new Error("This study changed in another session. Reload and retry.");
    definition = { ...saved.definition, asOf: requestedDefinition.asOf, priceMode: requestedDefinition.priceMode };
  }
  const now = options.now ?? new Date();
  const range = eventPriceRange(definition);
  const coverage = await ensurePriceCoverage([definition.instrument, definition.benchmark], range.start, range.end, {
    force: options.forcePriceRefresh, now,
  });
  const warnings = [...coverage.warnings];
  let rows = coverage.rows.filter((row) => row.isFinal !== false);
  const allEvents = [...definition.historicalEvents, definition.currentEvent];
  const betaByEvent = new Map<string, Awaited<ReturnType<typeof resolveEventBeta>>["beta"]>();
  for (const event of allEvents) {
    try {
      const resolved = await resolveEventBeta(definition, event, rows);
      betaByEvent.set(event.id, resolved.beta);
      warnings.push(...resolved.warnings);
    } catch (error) {
      betaByEvent.set(event.id, null);
      warnings.push(`Beta unavailable for ${event.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let quoteAsOf: string | null = null;
  let priceStatus: "eod" | "latest" = "eod";
  if (includeLatest && definition.priceMode === "latest") {
    try {
      const [instrumentQuote, benchmarkQuote] = await Promise.all([
        latestQuote(definition.instrument), latestQuote(definition.benchmark),
      ]);
      const validation = validateQuotePair(instrumentQuote, benchmarkQuote, now);
      if (!validation.accepted) {
        warnings.push(`Latest quote rejected; showing EOD. ${validation.reason}`);
      } else if (validation.date > definition.asOf) {
        warnings.push("Latest quote is after the study as-of date; showing EOD.");
      } else {
        rows = appendLatest(rows, definition.instrument, instrumentQuote.price, validation.date);
        rows = appendLatest(rows, definition.benchmark, benchmarkQuote.price, validation.date);
        quoteAsOf = new Date(Math.min(Date.parse(instrumentQuote.quoteAsOf), Date.parse(benchmarkQuote.quoteAsOf))).toISOString();
        priceStatus = "latest";
      }
    } catch (error) {
      warnings.push(`Latest quote failed; showing EOD. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const historical = definition.historicalEvents.map((event) => alignEventSeries(definition, event, rows, betaByEvent.get(event.id) ?? null, false));
  const current = alignEventSeries(definition, definition.currentEvent, rows, betaByEvent.get(definition.currentEvent.id) ?? null, true);
  const series = [...historical, current];
  const visibleCurrentPoints = current.points.filter((point) => point.day <= definition.postDays && point.day >= -definition.preDays);
  const dataAsOf = visibleCurrentPoints.at(-1)?.date ?? current.effectiveDay0;
  const priceStale = (visibleCurrentPoints.at(-1)?.day ?? -1) < definition.postDays && dataAsOf < definition.asOf;
  if (priceStale) warnings.push(`Stale price: latest available price is ${dataAsOf} (study as of ${definition.asOf}).`);
  const distributions = {
    raw: calculateDistribution(series, "raw"), excess: calculateDistribution(series, "excess"), beta: calculateDistribution(series, "beta"),
  };
  const outcomesByLens = {
    raw: calculateOutcomes(series, "raw"), excess: calculateOutcomes(series, "excess"), beta: calculateOutcomes(series, "beta"),
  };
  const betas = Object.fromEntries(series.map((event) => [event.eventId, event.beta]));
  const calculationVersion = process.env.FASTEVENT_CALCULATION_VERSION ?? "v2-daily-car";
  const result: EventStudyResponse = {
    definition, beta: current.beta, betas, betaAvailable: series.some((event) => Boolean(event.beta)), series,
    distribution: distributions[definition.lens], distributions, outcomes: outcomesByLens[definition.lens], outcomesByLens,
    dataAsOf, priceStale, priceStatus, quoteAsOf,
    provenance: { marketDataProvider: marketDataProvider().name, priceBasis: "adjusted_close", betaMethod: "ols_with_intercept",
      betaWindowCalendarDays: 365, betaMinimumObservations: 200, betaMinimumCoverage: 0.9, calculationVersion },
    warnings: [...new Set(warnings)],
  };
  if (target) result.runId = await persistStudyRun(target.studyId, target.studyRevision, result) ?? undefined;
  return result;
}
