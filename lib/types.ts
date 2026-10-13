export const INSTRUMENTS = ["SOXX", "QQQ", "SPY", "NVDA", "XLK"] as const;
export const BENCHMARKS = ["QQQ", "SPY", "XLK", "SOXX"] as const;
export const RETURN_LENSES = ["raw", "excess", "beta"] as const;

export type Instrument = (typeof INSTRUMENTS)[number];
export type Benchmark = (typeof BENCHMARKS)[number];
export type ReturnLens = (typeof RETURN_LENSES)[number];

export type Milestone = {
  id: string;
  label: string;
  date: string;
  active: boolean;
};

export type StudyEvent = {
  id: string;
  label: string;
  day0: string;
  active: boolean;
  milestones: Milestone[];
};

export type StudyDefinition = {
  name: string;
  instrument: Instrument;
  benchmark: Benchmark;
  lens: ReturnLens;
  preDays: number;
  postDays: number;
  asOf: string;
  priceMode: "eod" | "latest";
  currentEvent: StudyEvent;
  historicalEvents: StudyEvent[];
  display: {
    showMedian: boolean;
    showBand: boolean;
    showPre: boolean;
    showMilestones: boolean;
    view: "overlay" | "range";
  };
};

export type SavedStudy = {
  id: string;
  name: string;
  definition: StudyDefinition;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type PriceRow = {
  symbol: string;
  date: string;
  rawClose: number;
  adjustedClose: number;
  isFinal?: boolean;
  source?: "eod" | "latest";
};

export type BetaReading = {
  instrument: string;
  benchmark: string;
  beta: number;
  asOfDate: string;
  alignedObservations: number;
  coverageRatio: number;
  calculationVersion: string;
  calculatedAt: string;
  stale: boolean;
};

export type QuoteReading = {
  symbol: string;
  price: number;
  quoteAsOf: string;
  marketState: string | null;
  provider: string;
  cached: boolean;
};

export type AlignedPoint = {
  day: number;
  date: string;
  value: number | null;
  rawReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  betaAdjustedReturn: number | null;
  dailyInstrumentReturn: number | null;
  dailyBenchmarkReturn: number | null;
  dailyAbnormalReturn: number | null;
  instrumentAdjustedPrice: number;
  benchmarkAdjustedPrice: number;
  source: "eod" | "latest";
};

export type AlignedMilestone = Milestone & {
  eventId: string;
  eventLabel: string;
  day: number;
  effectiveDate: string;
};

export type EventSeries = {
  eventId: string;
  label: string;
  requestedDay0: string;
  effectiveDay0: string;
  current: boolean;
  active: boolean;
  beta: BetaReading | null;
  points: AlignedPoint[];
  milestones: AlignedMilestone[];
};

export type DistributionPoint = {
  day: number;
  q1: number;
  median: number;
  q3: number;
};

export type OutcomeRow = {
  eventId: string;
  label: string;
  effectiveDay0: string;
  current: boolean;
  day1: number | null;
  day5: number | null;
  day20: number | null;
  worstDrawdown: number | null;
};

export type EventStudyResponse = {
  definition: StudyDefinition;
  beta: BetaReading | null;
  betaAvailable: boolean;
  betas: Record<string, BetaReading | null>;
  series: EventSeries[];
  distribution: DistributionPoint[];
  distributions: Record<ReturnLens, DistributionPoint[]>;
  outcomes: OutcomeRow[];
  outcomesByLens: Record<ReturnLens, OutcomeRow[]>;
  dataAsOf: string;
  priceStale: boolean;
  priceStatus: "eod" | "latest";
  quoteAsOf: string | null;
  provenance: {
    marketDataProvider: string;
    priceBasis: "adjusted_close";
    betaMethod: "ols_with_intercept";
    betaWindowCalendarDays: 365;
    betaMinimumObservations: 200;
    betaMinimumCoverage: 0.9;
    calculationVersion: string;
  };
  warnings: string[];
  runId?: string;
};
