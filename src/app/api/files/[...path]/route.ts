import { NextResponse } from "next/server";
import { statSync } from "node:fs";
import path from "node:path";

import { deleteFile, listFiles, readFile, saveFile } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * GET /api/files/<path>
 * - If <path> points to a file: serve it with the detected Content-Type.
 * - If <path> points to a directory: return a JSON listing of the files.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  const { path: segments } = await params;
  const relPath = (segments ?? []).join("/");

  if (!relPath) {
    return NextResponse.json({ error: "Path required." }, { status: 400 });
  }

  try {
    const absolute = path.join(process.cwd(), "data", "uploads", relPath);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      const files = listFiles(relPath);
      return NextResponse.json({ files });
    }
    const buffer = readFile(relPath);
    const contentType = relPath.toLowerCase().endsWith(".png")
      ? "image/png"
      : relPath.toLowerCase().endsWith(".jpg") || relPath.toLowerCase().endsWith(".jpeg")
        ? "image/jpeg"
        : "application/octet-stream";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}

/**
 * POST /api/files/<path>
 * Upload a file to the local storage. The request body is the raw file bytes;
 * Content-Type is read from the headers.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  const { path: segments } = await params;
  const relPath = (segments ?? []).join("/");

  if (!relPath) {
    return NextResponse.json({ error: "Path required." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await request.arrayBuffer());
    saveFile(relPath, buffer);
    return NextResponse.json({ path: relPath, url: `/api/files/${relPath}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/files/<path>
 * Alias for POST (idempotent upload).
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  return POST(request, context);
}

/**
 * DELETE /api/files/<path>
 * Delete a file from local storage.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  const { path: segments } = await params;
  const relPath = (segments ?? []).join("/");

  if (!relPath) {
    return NextResponse.json({ error: "Path required." }, { status: 400 });
  }

  try {
    deleteFile(relPath);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
