import { NextResponse } from "next/server";

import { searchApps } from "@/lib/aso";
import { STORE_PLATFORMS } from "@/lib/constants";
import type { StorePlatform } from "@/types";

export const runtime = "nodejs";

/** GET /api/apps/search?store=appstore|playstore&q=… — autocomplete competitors. */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store") as StorePlatform | null;
  const q = searchParams.get("q")?.trim() ?? "";

  if (!store || !STORE_PLATFORMS.includes(store)) {
    return NextResponse.json({ error: "Invalid store." }, { status: 400 });
  }
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    const results = await searchApps(store, q);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Search failed." },
      { status: 502 }
    );
  }
}
