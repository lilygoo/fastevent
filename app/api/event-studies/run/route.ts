import { NextResponse } from "next/server";
import { runEventStudy } from "@/lib/event-study-service";
import { runRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const parsed = runRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid event study.", issues: parsed.error.issues }, { status: 400 });
    }
    return NextResponse.json(await runEventStudy(parsed.data.definition, parsed.data.checkBeta, parsed.data.includeLatest));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run the event study." }, { status: 503 });
  }
}
