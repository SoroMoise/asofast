import sharp from "sharp";

import { loadFonts, loadScriptFonts } from "@/lib/ai/generation/screenshot/fonts";

export { warmFonts } from "@/lib/ai/generation/screenshot/fonts";
import { applyColorOverrides } from "@/lib/ai/generation/screenshot/color-overrides";
import { renderFrame } from "@/lib/ai/generation/screenshot/render";
import { DEFAULT_STYLE } from "@/lib/ai/generation/screenshot/style";
import { completeJSON, completeJSONWithImages } from "@/lib/ai/providers";
import type { ScreenshotStyle } from "@/lib/ai/types";
import { getPrompt, renderTemplate } from "@/lib/aso/prompts";
import { deleteFile, listFiles, readFile, saveFile } from "@/lib/storage";
import type { Project } from "@/types";

const MAX_SHOTS = 10;
const VISION_CHUNK = 5;

export const MAX_CAPTION_LENGTH = 80;

const STORE_SIZES = {
  appstore: {
    phone: { width: 1290, height: 2796 },
    tablet: { width: 2048, height: 2732 },
  },
  playstore: {
    phone: { width: 1080, height: 1920 },
    tablet: { width: 1600, height: 2560 },
  },
} as const;

export type ScreenshotDevice = "phone" | "tablet";

export type ScreenshotFrame = {
  url: string;
  caption: string;
  sourcePath: string;
};

export type SourceCaption = { path: string; caption: string };

export const SCREENSHOT_STYLE: ScreenshotStyle = {
  ...DEFAULT_STYLE,
  captionPlacement: "top",
};

export function sortByCaptionOrder(
  project: Project,
  device: ScreenshotDevice,
  paths: string[]
): string[] {
  const storedRaw =
    device === "tablet" ? project.screenshot_captions_tablet : project.screenshot_captions;
  const stored = Array.isArray(storedRaw) ? (storedRaw as unknown as SourceCaption[]) : [];
  if (stored.length === 0) return paths;
  const rank = new Map(stored.map((c, i) => [c.path, i]));
  return paths
    .map((path, i) => ({ path, i }))
    .sort((a, b) => {
      const ra = rank.get(a.path);
      const rb = rank.get(b.path);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return a.i - b.i;
    })
    .map((x) => x.path);
}

export async function listUserScreenshots(
  project: Project,
  device: ScreenshotDevice = "phone"
): Promise<string[]> {
  const prefix = device === "tablet" ? `${project.id}/tablet` : project.id;
  const files = listFiles(prefix);
  const paths = files.slice(0, MAX_SHOTS).map((f) => f.path);
  return sortByCaptionOrder(project, device, paths);
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function downloadAsDataUrl(path: string): Promise<string> {
  const buffer = readFile(path);
  const contentType = contentTypeForPath(path);
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function captionUserScreenshots(
  appName: string,
  sourceLocale: string,
  images: { path: string; dataUrl: string }[]
): Promise<SourceCaption[]> {
  const prompt = await getPrompt("aso_caption_screenshots");
  const out: SourceCaption[] = [];
  for (let i = 0; i < images.length; i += VISION_CHUNK) {
    const chunk = images.slice(i, i + VISION_CHUNK);
    const variables = {
      count: String(chunk.length),
      app_name: appName,
      source_locale: sourceLocale,
    };

    const raw = (await completeJSONWithImages(
      renderTemplate(prompt.system, variables),
      renderTemplate(prompt.user, variables),
      chunk.map((c) => c.dataUrl)
    )) as { captions?: unknown };

    const captions = Array.isArray(raw.captions)
      ? raw.captions.filter((c): c is string => typeof c === "string")
      : [];
    chunk.forEach((img, j) => {
      out.push({
        path: img.path,
        caption: (captions[j]?.trim() || appName).slice(0, MAX_CAPTION_LENGTH),
      });
    });
  }
  return out;
}

export async function translateCaptions(
  captions: string[],
  fromLocale: string,
  toLocale: string
): Promise<string[]> {
  if (toLocale === fromLocale || captions.length === 0) return captions;

  const prompt = await getPrompt("aso_translate_captions");
  const variables = {
    from_locale: fromLocale,
    to_locale: toLocale,
    count: String(captions.length),
    captions_json: JSON.stringify({ captions }),
  };

  try {
    const raw = (await completeJSON(
      renderTemplate(prompt.system, variables),
      renderTemplate(prompt.user, variables)
    )) as {
      captions?: unknown;
    };
    const translated = Array.isArray(raw.captions)
      ? raw.captions.filter((c): c is string => typeof c === "string")
      : [];
    return captions.map((c, i) =>
      (translated[i]?.trim() || c).slice(0, MAX_CAPTION_LENGTH)
    );
  } catch {
    return captions;
  }
}

const JPEG_QUALITY = 82;

async function uploadFrame(outPath: string, body: Buffer): Promise<string> {
  saveFile(outPath, body);
  return `/api/files/${outPath}`;
}

function localePrefix(project: Project, locale: string, device: ScreenshotDevice): string {
  return device === "tablet"
    ? `${project.id}/aso/${locale}/tablet`
    : `${project.id}/aso/${locale}`;
}

async function removeStaleFrames(prefix: string, kept: number): Promise<void> {
  const keep = new Set(
    Array.from({ length: kept }, (_, i) => `${String(i + 1).padStart(2, "0")}.jpg`)
  );
  const files = listFiles(prefix);
  const stale = files.filter((f) => !keep.has(f.name)).map((f) => f.path);
  for (const path of stale) {
    try {
      deleteFile(path);
    } catch {
      // best-effort cleanup
    }
  }
}

export async function pruneLocaleFrames(
  project: Project,
  locale: string,
  keptByDevice: Record<ScreenshotDevice, number>
): Promise<void> {
  for (const device of ["phone", "tablet"] as const) {
    try {
      await removeStaleFrames(localePrefix(project, locale, device), keptByDevice[device]);
    } catch (e) {
      console.error(`[screenshots] stale cleanup failed for ${locale}/${device}:`, e);
    }
  }
}

export async function renderLocaleFrames(
  project: Project,
  locale: string,
  entries: { path: string; dataUrl: string; caption: string }[],
  style: ScreenshotStyle,
  device: ScreenshotDevice = "phone"
): Promise<ScreenshotFrame[]> {
  const resolvedStyle = applyColorOverrides(style, {
    backgroundColor: project.screenshot_bg_color,
    textColor: project.screenshot_text_color,
  });
  const tFonts = performance.now();
  const captions = entries.map((e) => e.caption).join(" ");
  const [fonts, script] = await Promise.all([loadFonts(), loadScriptFonts(captions, locale)]);
  if (script.missing.length > 0) {
    throw new Error(
      `Script font unavailable (${script.missing.join(", ")}): captions would render as empty boxes.`
    );
  }
  const fontsMs = Math.round(performance.now() - tFonts);
  const size = STORE_SIZES[project.store][device];
  const stamp = Date.now();
  const prefix = localePrefix(project, locale, device);
  let rasterMs = 0;
  let encodeMs = 0;
  let uploadSumMs = 0;
  let bytes = 0;

  const uploads: Promise<ScreenshotFrame>[] = [];
  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const tRaster = performance.now();
      const frame = await renderFrame({
        width: size.width,
        height: size.height,
        style: resolvedStyle,
        caption: entry.caption,
        screenshotDataUrl: entry.dataUrl,
        fonts,
        locale,
      });
      rasterMs += performance.now() - tRaster;

      const tEncode = performance.now();
      const jpeg = await sharp(frame.pixels, {
        raw: { width: frame.width, height: frame.height, channels: 4 },
      })
        .jpeg({ quality: JPEG_QUALITY, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      encodeMs += performance.now() - tEncode;
      bytes += jpeg.byteLength;

      const outPath = `${prefix}/${String(i + 1).padStart(2, "0")}.jpg`;
      const tUpload = performance.now();
      const pending = uploadFrame(outPath, jpeg).then((url) => {
        uploadSumMs += performance.now() - tUpload;
        return { url: `${url}?v=${stamp}`, caption: entry.caption, sourcePath: entry.path };
      });
      pending.catch(() => {});
      uploads.push(pending);
    }
  } catch (e) {
    await Promise.allSettled(uploads);
    throw e;
  }

  const tWait = performance.now();
  const frames = await Promise.all(uploads);
  const waitMs = Math.round(performance.now() - tWait);

  console.log(
    `[measure frames] locale=${locale} device=${device} n=${entries.length} ${size.width}x${size.height} fonts=${fontsMs}ms raster=${Math.round(rasterMs)}ms encode=${Math.round(encodeMs)}ms uploadSum=${Math.round(uploadSumMs)}ms wait=${waitMs}ms out=${Math.round(bytes / 1024)}KB`
  );
  return frames;
}

export async function loadSourceImages(
  paths: string[]
): Promise<{ path: string; dataUrl: string }[]> {
  return Promise.all(
    paths.map(async (path) => ({ path, dataUrl: await downloadAsDataUrl(path) }))
  );
}
