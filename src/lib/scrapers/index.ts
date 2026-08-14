import type { StorePlatform } from "@/types";

import { fetchAppStoreMetadata } from "./appstore";
import { fetchPlayStoreMetadata } from "./playstore";

/** Normalized listing metadata for an app on either store. */
export type AppMetadata = {
  store: StorePlatform;
  storeIdentifier: string;
  title: string;
  subtitle: string | null;
  description: string;
  developer: string | null;
  categories: string[];
  screenshots: string[];
  icon: string | null;
  rating: number | null;
  locale: string | null;
  url: string | null;
};

export type FetchOptions = { locale?: string; country?: string };

/**
 * Fetch the current store listing for an app.
 * - App Store: Apple's public iTunes lookup API (free).
 * - Google Play: the unofficial google-play-scraper library.
 */
export async function fetchAppMetadata(
  store: StorePlatform,
  identifier: string,
  opts?: FetchOptions
): Promise<AppMetadata> {
  if (store === "appstore") return fetchAppStoreMetadata(identifier, opts);
  return fetchPlayStoreMetadata(identifier, opts);
}
