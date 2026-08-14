import { NextResponse } from "next/server";

import { lookupApp } from "@/lib/aso";
import { STORE_PLATFORMS } from "@/lib/constants";
import type { StorePlatform } from "@/types";

export const runtime = "nodejs";

/** GET /api/apps/lookup?store=appstore|playstore&identifier=… */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store") as StorePlatform | null;
  const identifier = searchParams.get("identifier")?.trim() ?? "";

  if (!store || !STORE_PLATFORMS.includes(store)) {
    return NextResponse.json({ error: "Invalid store." }, { status: 400 });
  }
  if (!identifier) {
    return NextResponse.json({ error: "Identifier required." }, { status: 400 });
  }
  if (store === "appstore" && !/^\d+$/.test(identifier)) {
    return NextResponse.json(
      { error: "Invalid iOS App ID: a numeric identifier is expected (e.g. 6448311069)." },
      { status: 400 }
    );
  }

  try {
    const app = await lookupApp(store, identifier);
    return NextResponse.json({ app });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "App not found." },
      { status: 404 }
    );
  }
}
