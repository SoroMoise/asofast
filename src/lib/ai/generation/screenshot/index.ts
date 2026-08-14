import sharp from "sharp";

import { fetchAppMetadata, type AppMetadata } from "@/lib/scrapers";
import { readFile, saveFile } from "@/lib/storage";
import type { Generation, Project } from "@/types";
import type {
  ScreenshotFrame,
  ScreenshotGenInput,
  ScreenshotOutput,
} from "@/lib/ai/types";

import { loadFonts } from "./fonts";
import { renderFrame } from "./render";
import { applyColorOverrides } from "./color-overrides";
import { DEFAULT_STYLE, extractStyleProfile, generateCaptions } from "./style";

const MAX_UPLOADS = 5;

const SIZES = [
  { key: "ios-6.9", width: 1290, height: 2796 },
  { key: "android", width: 1080, height: 2400 },
] as const;

function parseInput(raw: unknown): ScreenshotGenInput {
  const value = (raw ?? {}) as Partial<ScreenshotGenInput>;
  return {
    competitors: Array.isArray(value.competitors) ? value.competitors : [],
    uploadedPaths: Array.isArray(value.uploadedPaths) ? value.uploadedPaths : [],
    targetLocale: value.targetLocale ?? null,
  };
}

function fallbackMeta(project: Project): AppMetadata {
  return {
    store: project.store,
    storeIdentifier: project.store_identifier,
    title: project.name,
    subtitle: null,
    description: "",
    developer: null,
    categories: [],
    screenshots: [],
    icon: null,
    rating: null,
    locale: project.source_locale,
    url: null,
  };
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

export async function generateScreenshots(
  gen: Generation,
  project: Project
): Promise<ScreenshotOutput> {
  const input = parseInput(gen.input);

  if (input.uploadedPaths.length === 0) {
    throw new Error("No screenshot uploaded. Add at least one screenshot.");
  }
  const paths = input.uploadedPaths.slice(0, MAX_UPLOADS);
  const targetLocale = input.targetLocale ?? project.source_locale;

  const competitorUrls: string[] = [];
  for (const competitor of input.competitors.slice(0, 3)) {
    try {
      const meta = await fetchAppMetadata(competitor.store, competitor.identifier, {
        locale: targetLocale,
      });
      competitorUrls.push(...meta.screenshots.slice(0, 2));
    } catch {
      // Skip an unreachable competitor.
    }
  }
  const style = applyColorOverrides(
    competitorUrls.length ? await extractStyleProfile(competitorUrls) : DEFAULT_STYLE,
    {
      backgroundColor: project.screenshot_bg_color,
      textColor: project.screenshot_text_color,
    }
  );

  let appMeta: AppMetadata;
  try {
    appMeta = await fetchAppMetadata(project.store, project.store_identifier, {
      locale: project.source_locale,
    });
  } catch {
    appMeta = fallbackMeta(project);
  }
  const captions = await generateCaptions(appMeta, paths.length, targetLocale);

  const fonts = await loadFonts();
  const frames: ScreenshotFrame[] = [];

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const caption = captions[i] ?? project.name;
    const screenshotDataUrl = await downloadAsDataUrl(path);

    for (const size of SIZES) {
      const frame = await renderFrame({
        width: size.width,
        height: size.height,
        style,
        caption,
        screenshotDataUrl,
        fonts,
        locale: targetLocale,
      });
      const png = await sharp(frame.pixels, {
        raw: { width: frame.width, height: frame.height, channels: 4 },
      })
        .png()
        .toBuffer();

      const outPath = `${project.id}/${gen.id}/${i}-${size.key}.png`;
      saveFile(outPath, png);
      frames.push({
        url: `/api/files/${outPath}`,
        caption,
        size: size.key,
        sourcePath: path,
      });
    }
  }

  return { frames, style, captions };
}
