import { NextResponse } from "next/server";
import { createStudy, listStudies } from "@/lib/studies";
import { createStudySchema } from "@/lib/validation";
import { resolveBeta } from "@/lib/market-data";

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
    const betaResult = await resolveBeta(study.definition, true);
    return NextResponse.json({ study, beta: betaResult.beta, warnings: betaResult.warnings }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the study.";
    return NextResponse.json({ error: message }, { status: message.toLowerCase().includes("unique") ? 409 : 503 });
  }
}
