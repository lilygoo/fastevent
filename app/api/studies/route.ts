import { NextResponse } from "next/server";
import { createStudy, listStudies } from "@/lib/studies";
import { createStudySchema } from "@/lib/validation";
import { runEventStudy } from "@/lib/event-study-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json({ studies: await listStudies() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load studies." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createStudySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid study.", issues: parsed.error.issues }, { status: 400 });
    const study = await createStudy(parsed.data.definition);
    try {
      const result = await runEventStudy(study.definition, true, false, { studyId: study.id, studyRevision: study.revision });
      return NextResponse.json({ study, result }, { status: 201 });
    } catch (error) {
      return NextResponse.json({ study, result: null,
        calculationError: error instanceof Error ? error.message : "The study was saved, but its run failed." }, { status: 201 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the study.";
    return NextResponse.json({ error: message }, { status: message.toLowerCase().includes("unique") ? 409 : 503 });
  }
}
