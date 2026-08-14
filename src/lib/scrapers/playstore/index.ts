import gplay from "google-play-scraper";

import type { AppMetadata, FetchOptions } from "../index";

/**
 * Google Play metadata via the unofficial google-play-scraper library.
 * `identifier` is the package name (e.g. com.acme.app).
 */
export async function fetchPlayStoreMetadata(
  identifier: string,
  opts?: FetchOptions
): Promise<AppMetadata> {
  // hl accepte les codes BCP-47 complets (pt-BR ≠ pt-PT, zh-TW ≠ zh-CN).
  const lang = opts?.locale ?? "en";
  const country = opts?.country ?? "us";

  let app: Awaited<ReturnType<typeof gplay.app>>;
  try {
    app = await gplay.app({ appId: identifier, lang, country });
  } catch {
    throw new Error(`App not found on Google Play: ${identifier}`);
  }

  return {
    store: "playstore",
    storeIdentifier: identifier,
    title: app.title ?? identifier,
    subtitle: app.summary ?? null,
    description: app.description ?? "",
    developer: app.developer ?? null,
    categories: app.genre ? [app.genre] : [],
    screenshots: app.screenshots ?? [],
    icon: app.icon ?? null,
    rating: typeof app.score === "number" ? app.score : null,
    locale: opts?.locale ?? null,
    url: app.url ?? null,
  };
}
