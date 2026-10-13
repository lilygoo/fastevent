import { todayEastern } from "../lib/dates";
import { runEventStudy } from "../lib/event-study-service";
import { listStudies } from "../lib/studies";

async function main() {
  const studies = await listStudies();
  const failures: string[] = [];
  for (const study of studies) {
    const definition = structuredClone(study.definition);
    definition.asOf = todayEastern();
    definition.priceMode = "eod";
    try {
      const result = await runEventStudy(definition, true, false, { studyId: study.id, studyRevision: study.revision });
      process.stdout.write(`${study.name}: ${result.runId ?? "calculated without persistence"}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${study.name}: ${message}`);
      process.stderr.write(`${study.name}: ${message}\n`);
    }
  }
  if (failures.length) throw new Error(`${failures.length} study run(s) failed.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
