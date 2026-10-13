import { NextResponse } from "next/server";
import { deleteStudy, getStudy, updateStudy } from "@/lib/studies";
import { runEventStudy } from "@/lib/event-study-service";
import { getLatestStudyRun } from "@/lib/study-results";
import { deleteStudySchema, updateStudySchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const study = await getStudy(id);
    if (!study) return NextResponse.json({ error: "Study not found." }, { status: 404 });
    const result = await getLatestStudyRun(study.id, study.revision, study.definition);
    return NextResponse.json({ study, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the study." }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const parsed = updateStudySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid study update.", issues: parsed.error.issues }, { status: 400 });
    const { id } = await context.params;
    const study = await updateStudy(id, parsed.data.definition, parsed.data.revision);
    if (!study) return NextResponse.json({ error: "This study changed in another session. Reload and retry." }, { status: 409 });
    try {
      const result = await runEventStudy(study.definition, true, false, { studyId: study.id, studyRevision: study.revision });
      return NextResponse.json({ study, result });
    } catch (error) {
      return NextResponse.json({ study, result: null,
        calculationError: error instanceof Error ? error.message : "The study was updated, but its run failed." });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the study.";
    return NextResponse.json({ error: message }, { status: message.toLowerCase().includes("unique") ? 409 : 503 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const parsed = deleteStudySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid delete request." }, { status: 400 });
    const { id } = await context.params;
    if (!await deleteStudy(id, parsed.data.revision)) {
      return NextResponse.json({ error: "This study changed in another session. Reload and retry." }, { status: 409 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete the study." }, { status: 503 });
  }
}
