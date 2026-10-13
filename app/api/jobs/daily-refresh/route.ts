import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { refreshNextStudy } from "@/lib/daily-refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.FASTEVENT_JOB_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const after = new URL(request.url).searchParams.get("after");
  try {
    return NextResponse.json(await refreshNextStudy(after));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Daily refresh failed." }, { status: 503 });
  }
}
