import gplay from "google-play-scraper";

import { fetchAppMetadata } from "@/lib/scrapers";
import type { StorePlatform } from "@/types";

import type { AppRef } from "./types";

/**
 * Storefronts essayés pour résoudre un App ID iOS: l'API iTunes ne renvoie une
 * app que si elle est disponible dans le pays interrogé.
 */
const APPSTORE_LOOKUP_COUNTRIES = ["us", "fr", "gb", "de", "ca"];

/**
 * Valide un identifiant (App ID numérique iOS / package name Android) et
 * renvoie nom + développeur + icône.
 */
export async function lookupApp(
  store: StorePlatform,
  identifier: string
): Promise<AppRef> {
  const id = identifier.trim();

  const meta =
    store === "appstore"
      ? await Promise.any(
          APPSTORE_LOOKUP_COUNTRIES.map((country) => fetchAppMetadata(store, id, { country }))
        ).catch(() => {
          throw new Error(`App not found on the App Store: ${id}`);
        })
      : await fetchAppMetadata(store, id);

  return {
    store,
    identifier: id,
    name: meta.title,
    developer: meta.developer,
    icon: meta.icon,
  };
}

interface ITunesSearchResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
}

/** Recherche d'apps par nom sur un store (autocomplete compétiteurs). */
export async function searchApps(
  store: StorePlatform,
  term: string,
  limit = 6
): Promise<AppRef[]> {
  const q = term.trim();
  if (!q) return [];

  if (store === "appstore") {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      q
    )}&entity=software&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`App Store search failed (HTTP ${res.status}).`);
    const data = (await res.json()) as { results?: ITunesSearchResult[] };
    return (data.results ?? [])
      .filter((r) => r.trackId && r.trackName)
      .map((r) => ({
        store: "appstore" as const,
        identifier: String(r.trackId),
        name: r.trackName as string,
        developer: r.artistName ?? null,
        icon: r.artworkUrl512 ?? r.artworkUrl100 ?? null,
      }));
  }

  const results = await gplay.search({ term: q, num: limit });
  return results.map((r) => ({
    store: "playstore" as const,
    identifier: r.appId,
    name: r.title,
    developer: r.developer ?? null,
    icon: r.icon ?? null,
  }));
}
