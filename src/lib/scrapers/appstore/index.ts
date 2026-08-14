import type { AppMetadata, FetchOptions } from "../index";

interface ITunesResult {
  trackName?: string;
  description?: string;
  artistName?: string;
  sellerName?: string;
  primaryGenreName?: string;
  genres?: string[];
  screenshotUrls?: string[];
  artworkUrl512?: string;
  artworkUrl100?: string;
  averageUserRating?: number;
  trackViewUrl?: string;
  bundleId?: string;
}

interface ITunesResponse {
  resultCount: number;
  results: ITunesResult[];
}

/**
 * App Store metadata via Apple's public iTunes lookup API. `identifier` may be a
 * numeric track id or a bundle id (e.g. com.acme.app).
 */
export async function fetchAppStoreMetadata(
  identifier: string,
  opts?: FetchOptions
): Promise<AppMetadata> {
  const country = opts?.country ?? "us";
  const isNumericId = /^\d+$/.test(identifier);
  const key = isNumericId ? "id" : "bundleId";
  // lang force la langue de la fiche quand le storefront en sert plusieurs
  // (format iTunes: fr_fr). Ignoré par l'API si non supporté.
  const lang = opts?.locale ? `&lang=${opts.locale.replace("-", "_").toLowerCase()}` : "";
  const url = `https://itunes.apple.com/lookup?${key}=${encodeURIComponent(
    identifier
  )}&country=${encodeURIComponent(country)}&entity=software${lang}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Avoid Next caching a stale listing.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`iTunes lookup failed (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as ITunesResponse;
  const app = data.results?.[0];
  if (!app) {
    throw new Error(`App not found on the App Store: ${identifier}`);
  }

  return {
    store: "appstore",
    storeIdentifier: identifier,
    title: app.trackName ?? identifier,
    subtitle: null, // iTunes lookup does not expose the App Store subtitle.
    description: app.description ?? "",
    developer: app.artistName ?? app.sellerName ?? null,
    categories: app.genres ?? (app.primaryGenreName ? [app.primaryGenreName] : []),
    screenshots: app.screenshotUrls ?? [],
    icon: app.artworkUrl512 ?? app.artworkUrl100 ?? null,
    rating: typeof app.averageUserRating === "number" ? app.averageUserRating : null,
    locale: opts?.locale ?? null,
    url: app.trackViewUrl ?? null,
  };
}
