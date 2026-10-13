import "server-only";
import { todayEastern } from "@/lib/dates";
import { runEventStudy } from "@/lib/event-study-service";
import { getAdminClient } from "@/lib/supabase";
import type { SavedStudy, StudyDefinition } from "@/lib/types";

function mapStudy(row: Record<string, unknown>): SavedStudy {
  return { id: String(row.id), name: String(row.name), definition: row.definition as StudyDefinition,
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

async function isComplete(study: SavedStudy) {
  const client = getAdminClient();
  if (!client) return false;
  const { data: run, error: runError } = await client.from("fastevent_study_runs").select("id")
    .eq("study_id", study.id).eq("study_revision", study.revision).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (runError) throw runError;
  if (!run) return false;
  const { data: current, error: currentError } = await client.from("fastevent_study_run_events").select("event_id")
    .eq("run_id", run.id).eq("is_current", true).maybeSingle();
  if (currentError) throw currentError;
  if (!current) return false;
  const { count, error } = await client.from("fastevent_study_return_points").select("relative_day", { count: "exact", head: true })
    .eq("run_id", run.id).eq("event_id", current.event_id).eq("relative_day", 50).eq("source", "eod");
  if (error) throw error;
  return Boolean(count);
}

export async function refreshNextStudy(after?: string | null) {
  const client = getAdminClient();
  if (!client) throw new Error("Supabase is required for the daily refresh job.");
  let query = client.from("fastevent_studies").select("id,name,definition,revision,created_at,updated_at")
    .is("deleted_at", null).order("id", { ascending: true }).limit(1);
  if (after) query = query.gt("id", after);
  const { data, error } = await query;
  if (error) throw error;
  const row = data?.[0];
  if (!row) return { done: true, nextCursor: null, ok: true };
  const study = mapStudy(row);
  try {
    if (await isComplete(study)) return { done: false, nextCursor: study.id, studyId: study.id, ok: true, status: "complete-window" };
    const definition = structuredClone(study.definition);
    definition.asOf = todayEastern();
    definition.priceMode = "eod";
    const result = await runEventStudy(definition, true, false, { studyId: study.id, studyRevision: study.revision }, { forcePriceRefresh: true });
    return { done: false, nextCursor: study.id, studyId: study.id, runId: result.runId, ok: true, status: "refreshed" };
  } catch (reason) {
    return { done: false, nextCursor: study.id, studyId: study.id, ok: false,
      status: "failed", error: reason instanceof Error ? reason.message : String(reason) };
  }
}
