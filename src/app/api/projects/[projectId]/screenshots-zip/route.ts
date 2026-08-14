import JSZip from "jszip";
import { NextResponse } from "next/server";

import { getListing } from "@/lib/db";
import type { ScreenshotFrame } from "@/lib/aso";
import { readFile } from "@/lib/storage";

export const runtime = "nodejs";

function extractLocalPath(url: string): string | null {
  const base = url.split("?")[0];
  if (base.startsWith("/api/files/")) {
    return decodeURIComponent(base.slice("/api/files/".length));
  }
  return null;
}

/**
 * GET /api/projects/{projectId}/screenshots-zip?locale=fr-FR&device=phone|tablet
 * Returns the numbered PNGs/JPEGs of the requested device (phone by default,
 * iPad/tablet if device=tablet).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const { projectId } = await params;

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale")?.trim() ?? "";
  if (!locale) return NextResponse.json({ error: "Locale required." }, { status: 400 });
  const device = searchParams.get("device") === "tablet" ? "tablet" : "phone";

  const listing = getListing(projectId, locale);
  const raw = device === "tablet" ? listing?.screenshots_tablet : listing?.screenshots;
  const frames = (Array.isArray(raw)
    ? (typeof raw === "string" ? JSON.parse(raw) : raw)
    : []) as unknown as ScreenshotFrame[];
  if (frames.length === 0) {
    return NextResponse.json(
      { error: "No screenshot generated for this language." },
      { status: 404 }
    );
  }

  const zip = new JSZip();
  await Promise.all(
    frames.map(async (frame, i) => {
      const localPath = extractLocalPath(frame.url);
      if (!localPath) {
        const res = await fetch(frame.url);
        if (!res.ok) throw new Error(`Download failed: ${frame.url}`);
        const ext = /\.jpe?g$/i.test(frame.url.split("?")[0]) ? "jpg" : "png";
        zip.file(`${String(i + 1).padStart(2, "0")}.${ext}`, await res.arrayBuffer());
        return;
      }
      const buffer = readFile(localPath);
      const ext = /\.jpe?g$/i.test(localPath) ? "jpg" : "png";
      zip.file(`${String(i + 1).padStart(2, "0")}.${ext}`, buffer);
    })
  );

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="screenshots-${device === "tablet" ? "tablet-" : ""}${locale}.zip"`,
    },
  });
}
