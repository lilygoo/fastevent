import { NextResponse } from "next/server";
import { latestQuote } from "@/lib/market-data";
import { quoteRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const parsed = quoteRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid symbols.", issues: parsed.error.issues }, { status: 400 });
    const quotes = await Promise.all(parsed.data.symbols.map((symbol) => latestQuote(symbol)));
    return NextResponse.json({ quotes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to fetch the latest quote." }, { status: 503 });
  }
}
