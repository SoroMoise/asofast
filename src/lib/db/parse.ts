import type { Listing, Project } from "@/types";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function parseProject(row: Record<string, unknown>): Project {
  return {
    ...(row as Record<string, never>),
    competitors: parseJson(row.competitors, []),
    target_locales: parseJson(row.target_locales, []),
    features: parseJson(row.features, []),
    screenshot_captions: parseJson(row.screenshot_captions, []),
    screenshot_captions_tablet: parseJson(row.screenshot_captions_tablet, []),
    competitor_keywords_en: parseJson(row.competitor_keywords_en, []),
  } as unknown as Project;
}

export function parseListing(row: Record<string, unknown>): Listing {
  return {
    ...(row as Record<string, never>),
    keyword_base: parseJson(row.keyword_base, []),
    screenshots: parseJson(row.screenshots, []),
    screenshots_tablet: parseJson(row.screenshots_tablet, []),
  } as unknown as Listing;
}
