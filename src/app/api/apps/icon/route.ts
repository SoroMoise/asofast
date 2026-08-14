import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const CACHE_DIR = path.join(process.cwd(), "data", "icons");
const ALLOWED_HOSTS = [".googleusercontent.com", ".mzstatic.com"];

function isAllowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((suffix) => lower.endsWith(suffix));
}

function detectContentType(buffer: Buffer): string {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  return "image/webp";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET /api/apps/icon?url=<store icon url> - proxy with disk cache and no Referer. */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url")?.trim() ?? "";

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL." }, { status: 400 });
  }

  if (url.protocol !== "https:") {
    return NextResponse.json({ error: "Only HTTPS URLs are allowed." }, { status: 400 });
  }
  if (!isAllowedHost(url.hostname)) {
    return NextResponse.json({ error: "Host not allowed." }, { status: 400 });
  }

  const key = createHash("sha1").update(url.toString()).digest("hex");
  const cachePath = path.join(CACHE_DIR, key);

  if (existsSync(cachePath)) {
    const buffer = readFileSync(cachePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": detectContentType(buffer),
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  let lastError: Error | null = null;
  const attempts = 4;
  const backoffs = [800, 1600, 2400];

  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await sleep(backoffs[i - 1] ?? 0);
    }

    try {
      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": "AsoFast/1.0 (local ASO tool)",
          Accept: "image/*",
        },
        redirect: "follow",
        cache: "no-store",
      });

      if (res.status === 429 || res.status === 403) {
        lastError = new Error(`Upstream returned ${res.status}.`);
        continue;
      }
      if (!res.ok) {
        return NextResponse.json({ error: `Upstream error: ${res.status}.` }, { status: 502 });
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cachePath, buffer);

      const contentType = res.headers.get("content-type") ?? "image/png";
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  return NextResponse.json(
    { error: lastError?.message ?? "Failed to fetch icon." },
    { status: 502 }
  );
}
