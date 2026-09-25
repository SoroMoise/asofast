import { completeJSON, completeJSONWithImages } from "@/lib/ai/providers";
import type { ScreenshotStyle } from "@/lib/ai/types";
import { getPrompt, renderTemplate } from "@/lib/aso/prompts";
import type { AppMetadata } from "@/lib/scrapers";

import { HEX } from "./color-overrides";

export const DEFAULT_STYLE: ScreenshotStyle = {
  backgroundColor: "#4f46e5",
  backgroundGradientTo: "#7c3aed",
  textColor: "#ffffff",
  accentColor: "#ffffff",
  fontFamily: "Poppins",
  fontWeight: "bold",
  captionCase: "none",
  captionPlacement: "top",
  deviceFrame: true,
};

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Extract a visual style profile from competitor store screenshots using a
 * vision model. Falls back to DEFAULT_STYLE if there are no images or the call
 * fails — a style extraction failure must not fail the whole generation.
 */
export async function extractStyleProfile(
  competitorImageUrls: string[]
): Promise<ScreenshotStyle> {
  if (competitorImageUrls.length === 0) return DEFAULT_STYLE;

  const prompt = await getPrompt("aso_screenshot_style");

  try {
    const raw = (await completeJSONWithImages(
      prompt.system,
      prompt.user,
      competitorImageUrls,
      "screenshot_style"
    )) as Record<string, unknown>;

    return {
      backgroundColor: hex(raw.backgroundColor, DEFAULT_STYLE.backgroundColor),
      backgroundGradientTo:
        raw.backgroundGradientTo === null
          ? null
          : hex(raw.backgroundGradientTo, DEFAULT_STYLE.backgroundGradientTo ?? DEFAULT_STYLE.backgroundColor),
      textColor: hex(raw.textColor, DEFAULT_STYLE.textColor),
      accentColor: hex(raw.accentColor, DEFAULT_STYLE.accentColor),
      fontFamily: "Poppins",
      fontWeight: oneOf(raw.fontWeight, ["regular", "semibold", "bold"] as const, "bold"),
      captionCase: oneOf(raw.captionCase, ["none", "upper", "title"] as const, "none"),
      captionPlacement: oneOf(raw.captionPlacement, ["top", "bottom"] as const, "top"),
      deviceFrame: typeof raw.deviceFrame === "boolean" ? raw.deviceFrame : true,
    };
  } catch {
    return DEFAULT_STYLE;
  }
}

/**
 * Generate `count` short marketing captions for the app, in the target locale,
 * matching the tone implied by the extracted style.
 */
export async function generateCaptions(
  meta: AppMetadata,
  count: number,
  targetLocale: string
): Promise<string[]> {
  if (count <= 0) return [];

  const prompt = await getPrompt("aso_screenshot_captions");
  const variables = {
    target_locale: targetLocale,
    count: String(count),
    app_title: meta.title,
    categories: meta.categories.join(", ") || "unknown",
    description: meta.description.slice(0, 800),
  };

  try {
    const raw = (await completeJSON(
      renderTemplate(prompt.system, variables),
      renderTemplate(prompt.user, variables),
      "screenshot_captions"
    )) as { captions?: unknown };
    const captions = Array.isArray(raw.captions)
      ? raw.captions.filter((c): c is string => typeof c === "string")
      : [];
    // Pad/trim to exactly `count`.
    while (captions.length < count) captions.push(meta.title);
    return captions.slice(0, count);
  } catch {
    return Array.from({ length: count }, () => meta.title);
  }
}
