import "server-only";
import { createHash } from "node:crypto";
import { calculateDistribution, calculateOutcomes } from "@/lib/calculations";
import { getAdminClient } from "@/lib/supabase";
import type { AlignedPoint, BetaReading, EventSeries, EventStudyResponse, StudyDefinition } from "@/lib/types";

function fingerprint(result: EventStudyResponse, revision: number) {
  const input = {
    revision,
    calculationVersion: result.provenance.calculationVersion,
    priceStatus: result.priceStatus,
    quoteAsOf: result.quoteAsOf,
    series: result.series.map((series) => ({
      eventId: series.eventId,
      beta: series.beta ? [series.beta.beta, series.beta.asOfDate, series.beta.calculationVersion] : null,
      points: series.points.map((point) => [point.day, point.date, point.instrumentAdjustedPrice, point.benchmarkAdjustedPrice, point.source]),
    })),
  };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function persistStudyRun(studyId: string, studyRevision: number, result: EventStudyResponse) {
  const client = getAdminClient();
  if (!client) return null;
  const events = result.series.map((series, ordinal) => ({
    event_id: series.eventId, ordinal, label: series.label, requested_day0: series.requestedDay0,
    effective_day0: series.effectiveDay0, is_current: series.current, is_active: series.active,
    beta: series.beta?.beta ?? null, beta_estimation_cutoff: series.beta?.asOfDate ?? null,
    beta_aligned_observations: series.beta?.alignedObservations ?? null,
    beta_coverage_ratio: series.beta?.coverageRatio ?? null,
    beta_calculation_version: series.beta?.calculationVersion ?? null,
    beta_calculated_at: series.beta?.calculatedAt ?? null,
  }));
  const points = result.series.flatMap((series) => series.points.map((point) => ({
    event_id: series.eventId, relative_day: point.day, price_date: point.date, source: point.source,
    instrument_adjusted_price: point.instrumentAdjustedPrice, benchmark_adjusted_price: point.benchmarkAdjustedPrice,
    instrument_daily_return: point.dailyInstrumentReturn, benchmark_daily_return: point.dailyBenchmarkReturn,
    abnormal_daily_return: point.dailyAbnormalReturn, raw_return: point.rawReturn,
    benchmark_return: point.benchmarkReturn, excess_return: point.excessReturn,
    beta_adjusted_return: point.betaAdjustedReturn,
  })));
  const { data, error } = await client.rpc("fastevent_store_study_run", {
    p_study_id: studyId,
    p_study_revision: studyRevision,
    p_as_of_date: result.definition.asOf,
    p_data_as_of: result.dataAsOf,
    p_price_status: result.priceStatus,
    p_quote_as_of: result.quoteAsOf,
    p_market_data_provider: result.provenance.marketDataProvider,
    p_calculation_version: result.provenance.calculationVersion,
    p_input_fingerprint: fingerprint(result, studyRevision),
    p_warnings: result.warnings,
    p_events: events,
    p_points: points,
  });
  if (error) throw error;
  return String(data);
}

function numberOrNull(value: unknown) { return value === null || value === undefined ? null : Number(value); }

function betaFromEvent(row: Record<string, unknown>, definition: StudyDefinition): BetaReading | null {
  if (row.beta === null || row.beta === undefined) return null;
  return {
    instrument: definition.instrument, benchmark: definition.benchmark, beta: Number(row.beta),
    asOfDate: String(row.beta_estimation_cutoff), alignedObservations: Number(row.beta_aligned_observations),
    coverageRatio: Number(row.beta_coverage_ratio), calculationVersion: String(row.beta_calculation_version),
    calculatedAt: String(row.beta_calculated_at), stale: false,
  };
}

export async function getLatestStudyRun(studyId: string, revision: number, definition: StudyDefinition): Promise<EventStudyResponse | null> {
  const client = getAdminClient();
  if (!client) return null;
  const { data: run, error: runError } = await client.from("fastevent_study_runs").select("*")
    .eq("study_id", studyId).eq("study_revision", revision).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (runError) throw runError;
  if (!run) return null;
  const [{ data: eventRows, error: eventError }, { data: pointRows, error: pointError }] = await Promise.all([
    client.from("fastevent_study_run_events").select("*").eq("run_id", run.id).order("ordinal"),
    client.from("fastevent_study_return_points").select("*").eq("run_id", run.id).order("relative_day"),
  ]);
  if (eventError) throw eventError;
  if (pointError) throw pointError;
  const series: EventSeries[] = (eventRows ?? []).map((eventRow) => {
    const points: AlignedPoint[] = (pointRows ?? []).filter((point) => point.event_id === eventRow.event_id).map((point) => {
      const rawReturn = Number(point.raw_return);
      const excessReturn = Number(point.excess_return);
      const betaAdjustedReturn = numberOrNull(point.beta_adjusted_return);
      return {
        day: Number(point.relative_day), date: String(point.price_date),
        value: definition.lens === "raw" ? rawReturn : definition.lens === "excess" ? excessReturn : betaAdjustedReturn,
        rawReturn, benchmarkReturn: Number(point.benchmark_return), excessReturn, betaAdjustedReturn,
        dailyInstrumentReturn: numberOrNull(point.instrument_daily_return),
        dailyBenchmarkReturn: numberOrNull(point.benchmark_daily_return),
        dailyAbnormalReturn: numberOrNull(point.abnormal_daily_return),
        instrumentAdjustedPrice: Number(point.instrument_adjusted_price),
        benchmarkAdjustedPrice: Number(point.benchmark_adjusted_price), source: point.source as "eod" | "latest",
      };
    });
    const definitionEvent = eventRow.is_current
      ? definition.currentEvent
      : definition.historicalEvents.find((event) => event.id === eventRow.event_id);
    const milestones = (definitionEvent?.milestones ?? []).flatMap((milestone) => {
      const point = points.find((candidate) => candidate.date >= milestone.date);
      return point ? [{ ...milestone, eventId: String(eventRow.event_id), eventLabel: String(eventRow.label), day: point.day, effectiveDate: point.date }] : [];
    });
    return {
      eventId: String(eventRow.event_id), label: String(eventRow.label), requestedDay0: String(eventRow.requested_day0),
      effectiveDay0: String(eventRow.effective_day0), current: Boolean(eventRow.is_current), active: Boolean(eventRow.is_active),
      beta: betaFromEvent(eventRow, definition), points, milestones,
    };
  });
  const distributions = {
    raw: calculateDistribution(series, "raw"), excess: calculateDistribution(series, "excess"), beta: calculateDistribution(series, "beta"),
  };
  const outcomesByLens = {
    raw: calculateOutcomes(series, "raw"), excess: calculateOutcomes(series, "excess"), beta: calculateOutcomes(series, "beta"),
  };
  const betas = Object.fromEntries(series.map((event) => [event.eventId, event.beta]));
  const currentBeta = series.find((event) => event.current)?.beta ?? null;
  const currentLastPoint = series.find((event) => event.current)?.points.filter((point) => point.day <= definition.postDays).at(-1);
  return {
    definition, beta: currentBeta, betas, betaAvailable: series.some((event) => Boolean(event.beta)), series,
    distribution: distributions[definition.lens], distributions, outcomes: outcomesByLens[definition.lens], outcomesByLens,
    dataAsOf: String(run.data_as_of), priceStale: (currentLastPoint?.day ?? -1) < definition.postDays && String(run.data_as_of) < definition.asOf,
    priceStatus: run.price_status as "eod" | "latest", quoteAsOf: run.quote_as_of ? String(run.quote_as_of) : null,
    provenance: {
      marketDataProvider: String(run.market_data_provider), priceBasis: "adjusted_close", betaMethod: "ols_with_intercept",
      betaWindowCalendarDays: 365, betaMinimumObservations: 200, betaMinimumCoverage: 0.9,
      calculationVersion: String(run.calculation_version),
    },
    warnings: (run.warnings ?? []).map(String), runId: String(run.id),
  };
}
