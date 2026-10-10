import "server-only";
import { getAdminClient } from "@/lib/supabase";
import type { EventStudyResponse } from "@/lib/types";

export async function persistStudyResult(studyId: string, studyRevision: number, result: EventStudyResponse) {
  const client = getAdminClient();
  if (!client) return false;

  const { data: study, error: studyError } = await client.from("fastevent_studies")
    .select("id")
    .eq("id", studyId)
    .eq("revision", studyRevision)
    .is("deleted_at", null)
    .maybeSingle();
  if (studyError) throw studyError;
  if (!study) throw new Error("The saved study changed before its calculated result could be stored.");

  const { error } = await client.from("fastevent_study_results").upsert({
    study_id: studyId,
    study_revision: studyRevision,
    as_of_date: result.definition.asOf,
    price_date: result.dataAsOf,
    price_status: result.priceStatus,
    quote_as_of: result.quoteAsOf,
    beta_calculated_at: result.beta?.calculatedAt ?? null,
    calculation_version: result.provenance.calculationVersion,
    result,
    calculated_at: new Date().toISOString(),
  }, { onConflict: "study_id" });
  if (error) throw error;
  return true;
}
