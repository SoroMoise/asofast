import type { FetchOptions } from "@/lib/scrapers";
import type { StorePlatform } from "@/types";

/** Storefront iTunes par locale App Store (le pays determine la langue servie). */
const APPSTORE_COUNTRY: Record<string, string> = {
  "ar-SA": "sa", ca: "es", "zh-Hans": "cn", "zh-Hant": "tw", ko: "kr",
  hr: "hr", da: "dk", "es-ES": "es", "es-MX": "mx", fi: "fi",
  "fr-FR": "fr", "fr-CA": "ca", el: "gr", he: "il", hi: "in",
  hu: "hu", id: "id", it: "it", ja: "jp", ms: "my",
  "nl-NL": "nl", no: "no", pl: "pl", "pt-BR": "br", "pt-PT": "pt",
  ro: "ro", ru: "ru", sk: "sk", sv: "se", cs: "cz",
  th: "th", tr: "tr", uk: "ua", vi: "vn", "de-DE": "de",
  "en-AU": "au", "en-CA": "ca", "en-GB": "gb", "en-US": "us",
  // Langues cibles App Store sans storefront dedie jusqu'ici (tombaient sur "us").
  // Storefront ou la localisation peut etre servie; la garantie de langue vient
  // de la traduction (runLocalePipeline), pas du storefront.
  "bn-BD": "bd", "gu-IN": "in", "kn-IN": "in", "ml-IN": "in", "mr-IN": "in",
  "or-IN": "in", "pa-IN": "in", "sl-SI": "si", "ta-IN": "in", "te-IN": "in",
  "ur-PK": "pk",
};

/**
 * Options scraper pour récupérer la fiche d'une app dans une locale donnée.
 * - App Store: le storefront (country) détermine la langue de la fiche.
 * - Google Play: hl (locale) + gl (pays, déduit de la région si présente).
 */
export function fetchOptionsForLocale(
  store: StorePlatform,
  locale: string
): FetchOptions {
  if (store === "appstore") {
    return { locale, country: APPSTORE_COUNTRY[locale] ?? "us" };
  }
  const region = locale.split("-")[1];
  const country =
    region && /^[a-zA-Z]{2}$/.test(region) ? region.toLowerCase() : "us";
  return { locale, country };
}

/**
 * Locale anglaise (en, en-US, en-GB...). L'anglais est la langue canonique du
 * pipeline: base de mots cles cachee en-US et features saisies en anglais. Une
 * locale anglaise ne declenche donc ni repli-traduction de la base ni traduction
 * des features.
 */
export function isEnglishLocale(locale: string): boolean {
  return /^en(-|$)/i.test(locale);
}
