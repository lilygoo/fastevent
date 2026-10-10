import type {
  BetaReading,
  DistributionPoint,
  EventSeries,
  OutcomeRow,
  PriceRow,
  StudyDefinition,
  StudyEvent,
} from "@/lib/types";

const DAY_MS = 86_400_000;

function dateMs(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function groupedPrices(rows: PriceRow[]) {
  const grouped = new Map<string, Map<string, PriceRow>>();
  for (const row of rows) {
    if (!grouped.has(row.symbol)) grouped.set(row.symbol, new Map());
    grouped.get(row.symbol)!.set(row.date, row);
  }
  return grouped;
}

export function calculateBeta(
  rows: PriceRow[],
  instrument: string,
  benchmark: string,
  asOfDate: string,
  options: { minimumObservations?: number; minimumCoverage?: number } = {},
) {
  const minimumObservations = options.minimumObservations ?? 200;
  const minimumCoverage = options.minimumCoverage ?? 0.9;
  const grouped = groupedPrices(rows);
  const instrumentRows = grouped.get(instrument) ?? new Map();
  const benchmarkRows = grouped.get(benchmark) ?? new Map();
  const boundary = dateMs(asOfDate) - 365 * DAY_MS;
  const benchmarkDates = [...benchmarkRows.keys()]
    .filter((date) => date <= asOfDate)
    .sort();
  const benchmarkReturns = new Map<string, number>();
  for (let index = 1; index < benchmarkDates.length; index += 1) {
    const date = benchmarkDates[index];
    if (dateMs(date) <= boundary) continue;
    const previous = benchmarkRows.get(benchmarkDates[index - 1])!;
    const current = benchmarkRows.get(date)!;
    benchmarkReturns.set(date, current.adjustedClose / previous.adjustedClose - 1);
  }

  const instrumentDates = [...instrumentRows.keys()]
    .filter((date) => date <= asOfDate)
    .sort();
  const instrumentReturns = new Map<string, number>();
  for (let index = 1; index < instrumentDates.length; index += 1) {
    const date = instrumentDates[index];
    if (dateMs(date) <= boundary) continue;
    const previous = instrumentRows.get(instrumentDates[index - 1])!;
    const current = instrumentRows.get(date)!;
    instrumentReturns.set(date, current.adjustedClose / previous.adjustedClose - 1);
  }

  const aligned = [...benchmarkReturns.entries()]
    .filter(([date]) => instrumentReturns.has(date))
    .map(([date, benchmarkReturn]) => ({ x: benchmarkReturn, y: instrumentReturns.get(date)! }));
  const coverageRatio = benchmarkReturns.size === 0 ? 0 : aligned.length / benchmarkReturns.size;
  if (aligned.length < minimumObservations) {
    return { beta: null, observations: aligned.length, coverageRatio, reason: "insufficient aligned observations" };
  }
  if (coverageRatio < minimumCoverage) {
    return { beta: null, observations: aligned.length, coverageRatio, reason: "insufficient benchmark coverage" };
  }
  const meanX = aligned.reduce((sum, point) => sum + point.x, 0) / aligned.length;
  const meanY = aligned.reduce((sum, point) => sum + point.y, 0) / aligned.length;
  const variance = aligned.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (variance === 0) {
    return { beta: null, observations: aligned.length, coverageRatio, reason: "benchmark variance is zero" };
  }
  const covariance = aligned.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  return { beta: covariance / variance, observations: aligned.length, coverageRatio, reason: null };
}

function alignMilestones(event: StudyEvent, jointDates: string[], day0Index: number) {
  return event.milestones.flatMap((milestone) => {
    const effectiveIndex = jointDates.findIndex((date) => date >= milestone.date);
    if (effectiveIndex < 0) return [];
    return [{
      ...milestone,
      eventId: event.id,
      eventLabel: event.label,
      day: effectiveIndex - day0Index,
      effectiveDate: jointDates[effectiveIndex],
    }];
  });
}

export function alignEventSeries(
  definition: StudyDefinition,
  event: StudyEvent,
  rows: PriceRow[],
  beta: BetaReading | null,
  current: boolean,
): EventSeries {
  const grouped = groupedPrices(rows);
  const instrumentRows = grouped.get(definition.instrument) ?? new Map();
  const benchmarkRows = grouped.get(definition.benchmark) ?? new Map();
  const jointDates = [...instrumentRows.keys()]
    .filter((date) => benchmarkRows.has(date) && date <= definition.asOf)
    .sort();
  const day0Index = jointDates.findIndex((date) => date >= event.day0);
  if (day0Index < 0) throw new Error(`No joint trading session is available on or after ${event.day0}.`);
  const effectiveDay0 = jointDates[day0Index];
  const startIndex = Math.max(0, day0Index - (definition.display.showPre ? definition.preDays : 0));
  const endIndex = Math.min(jointDates.length - 1, day0Index + definition.postDays);
  const instrumentBase = instrumentRows.get(effectiveDay0)!.adjustedClose;
  const benchmarkBase = benchmarkRows.get(effectiveDay0)!.adjustedClose;
  const points = jointDates.slice(startIndex, endIndex + 1).map((date, offset) => {
    const day = startIndex + offset - day0Index;
    const rawReturn = (instrumentRows.get(date)!.adjustedClose / instrumentBase - 1) * 100;
    const benchmarkReturn = (benchmarkRows.get(date)!.adjustedClose / benchmarkBase - 1) * 100;
    const value = definition.lens === "raw"
      ? rawReturn
      : definition.lens === "excess"
        ? rawReturn - benchmarkReturn
        : beta
          ? rawReturn - beta.beta * benchmarkReturn
          : null;
    return { day, date, value, rawReturn, benchmarkReturn };
  });
  return {
    eventId: event.id,
    label: event.label,
    requestedDay0: event.day0,
    effectiveDay0,
    current,
    active: event.active,
    points,
    milestones: alignMilestones(event, jointDates, day0Index),
  };
}

export function calculateDistribution(series: EventSeries[]): DistributionPoint[] {
  const valuesByDay = new Map<number, number[]>();
  for (const event of series.filter((item) => !item.current && item.active)) {
    for (const point of event.points) {
      if (point.value === null) continue;
      if (!valuesByDay.has(point.day)) valuesByDay.set(point.day, []);
      valuesByDay.get(point.day)!.push(point.value);
    }
  }
  return [...valuesByDay.entries()].sort(([a], [b]) => a - b).map(([day, values]) => ({
    day,
    q1: quantile(values, 0.25),
    median: quantile(values, 0.5),
    q3: quantile(values, 0.75),
  }));
}

function pointAt(series: EventSeries, day: number) {
  return series.points.find((point) => point.day === day)?.value ?? null;
}

export function calculateOutcomes(series: EventSeries[]): OutcomeRow[] {
  return series.map((event) => {
    const afterDay0 = event.points
      .filter((point) => point.day >= 0 && point.value !== null)
      .map((point) => point.value as number);
    return {
      eventId: event.eventId,
      label: event.label,
      effectiveDay0: event.effectiveDay0,
      current: event.current,
      day1: pointAt(event, 1),
      day5: pointAt(event, 5),
      day20: pointAt(event, 20),
      worstDrawdown: afterDay0.length ? Math.min(...afterDay0) : null,
    };
  });
}
