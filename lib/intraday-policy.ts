import { isTradingSession, todayEastern } from "@/lib/dates";
import type { PriceRow, QuoteReading } from "@/lib/types";

export type IntradayValidation = { accepted: true; date: string } | { accepted: false; reason: string };

export function validateQuotePair(instrument: QuoteReading, benchmark: QuoteReading, now = new Date()): IntradayValidation {
  if (!isTradingSession(now)) return { accepted: false, reason: "Latest quotes are only used during the defined U.S. trading session (weekdays, 9:30 a.m.–4:00 p.m. Eastern)." };
  if (instrument.price <= 0 || benchmark.price <= 0) return { accepted: false, reason: "A latest quote contained a non-positive price." };
  const today = todayEastern(now);
  const instrumentDate = todayEastern(new Date(instrument.quoteAsOf));
  const benchmarkDate = todayEastern(new Date(benchmark.quoteAsOf));
  if (instrumentDate !== today || benchmarkDate !== today) return { accepted: false, reason: "One or both latest quotes are not from today in U.S. Eastern time." };
  const instrumentAge = now.getTime() - Date.parse(instrument.quoteAsOf);
  const benchmarkAge = now.getTime() - Date.parse(benchmark.quoteAsOf);
  if (instrumentAge < -30_000 || benchmarkAge < -30_000 || instrumentAge > 120_000 || benchmarkAge > 120_000) {
    return { accepted: false, reason: "One or both latest quotes are more than two minutes old." };
  }
  if (Math.abs(Date.parse(instrument.quoteAsOf) - Date.parse(benchmark.quoteAsOf)) > 120_000) {
    return { accepted: false, reason: "Instrument and benchmark quote timestamps are more than two minutes apart." };
  }
  return { accepted: true, date: today };
}

export function adjustedQuotePrice(rows: PriceRow[], symbol: string, quotePrice: number, quoteDate: string) {
  const prior = rows.filter((row) => row.symbol === symbol && row.isFinal !== false && row.date <= quoteDate)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (!prior) throw new Error(`No finalized EOD price is available to adjust the ${symbol} quote.`);
  return quotePrice * (prior.adjustedClose / prior.rawClose);
}
