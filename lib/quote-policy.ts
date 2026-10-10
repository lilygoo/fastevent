export function isQuoteFresh(fetchedAt: string, ttlMs: number, now = Date.now()) {
  return now - Date.parse(fetchedAt) <= ttlMs;
}
