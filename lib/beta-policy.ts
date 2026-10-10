import type { BetaReading } from "@/lib/types";

export const BETA_MAX_AGE_MS = 30 * 86_400_000;

export function isBetaStale(calculatedAt: string, now = Date.now()) {
  return now - Date.parse(calculatedAt) > BETA_MAX_AGE_MS;
}

export function betaCacheAction(calculatedAt: string | null, checkBeta: boolean, now = Date.now()) {
  if (!calculatedAt) return checkBeta ? "refresh" : "unavailable";
  if (!checkBeta || !isBetaStale(calculatedAt, now)) return "reuse";
  return "refresh";
}

export function betaRefreshFailure(existing: BetaReading | null, message: string) {
  if (existing) {
    return {
      beta: { ...existing, stale: true },
      warnings: [`Beta refresh failed; using the prior value. ${message}`],
    };
  }
  return { beta: null, warnings: [`Beta calculation failed. ${message}`] };
}
