import { refreshNextStudy } from "../lib/daily-refresh";

async function main() {
  let cursor: string | null = null;
  let processed = 0;
  const failures: string[] = [];

  while (true) {
    const result = await refreshNextStudy(cursor);
    if (result.done) break;
    processed += 1;
    const studyId = result.studyId ?? "unknown";
    if (result.ok) {
      process.stdout.write(`${studyId}: ${result.status}${result.runId ? ` (${result.runId})` : ""}\n`);
    } else {
      const message = `${studyId}: ${result.error ?? "unknown refresh error"}`;
      failures.push(message);
      process.stderr.write(`${message}\n`);
    }
    if (!result.nextCursor) throw new Error("Daily refresh did not return a continuation cursor.");
    cursor = result.nextCursor;
  }

  process.stdout.write(`Processed ${processed} active ${processed === 1 ? "study" : "studies"}; ${failures.length} failed.\n`);
  if (failures.length) throw new Error(`${failures.length} daily refresh ${failures.length === 1 ? "operation" : "operations"} failed.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
