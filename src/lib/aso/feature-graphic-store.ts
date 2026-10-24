/**
 * Bannière (feature graphic) localisée — partie serveur SANS rendu: stockage,
 * traduction, empreinte (bannière périmée) et choix des textes. Le rendu satori
 * est dans feature-graphic.tsx, la mise en page pure dans feature-graphic-layout.ts.
 */
import { createHash } from "node:crypto";

import { completeJSON } from "@/lib/ai/providers";
import { getPrompt, renderTemplate } from "@/lib/aso/prompts";
import { deleteFile, listFiles, readFile, saveFile } from "@/lib/storage";

import {
  featureGraphicFingerprintSource,
  localeFeatureGraphicDir,
  localeFeatureGraphicPaths,
  MAX_BADGE_LENGTH,
  listingHeadline,
  MAX_HEADLINE_LENGTH,
  sanitizeFeatureGraphicTemplate,
  sanitizeFeatureGraphicTexts,
  sanitizeStoredFeatureGraphic,
  type FeatureGraphicTemplate,
  type FeatureGraphicTexts,
  type ListingHeadlineTexts,
  type StoredFeatureGraphic,
} from "./feature-graphic-layout";

function templatePath(projectId: string): string {
  return `${projectId}/feature-graphic/template.json`;
}

/** Modèle enregistré, ou null s'il n'a jamais été configuré. */
export function readFeatureGraphicTemplate(projectId: string): FeatureGraphicTemplate | null {
  try {
    return sanitizeFeatureGraphicTemplate(JSON.parse(readFile(templatePath(projectId)).toString("utf8")));
  } catch {
    return null;
  }
}

export function saveFeatureGraphicTemplate(projectId: string, raw: unknown): FeatureGraphicTemplate {
  const tpl = sanitizeFeatureGraphicTemplate(raw);
  saveFile(templatePath(projectId), Buffer.from(JSON.stringify(tpl, null, 2)));
  return tpl;
}

/** Chemin storage de l'illustration, ou null. */
export function findFeatureGraphicArt(projectId: string): string | null {
  const file = listFiles(`${projectId}/feature-graphic`).find((f) => f.name.startsWith("art."));
  return file?.path ?? null;
}

/** La génération localisée est-elle configurée pour ce projet ? */
export function isFeatureGraphicConfigured(projectId: string): boolean {
  return readFeatureGraphicTemplate(projectId) !== null && findFeatureGraphicArt(projectId) !== null;
}

/** Textes + métadonnées enregistrés pour une langue, ou null. */
export function readLocaleFeatureGraphic(
  projectId: string,
  locale: string
): StoredFeatureGraphic | null {
  try {
    const raw = readFile(localeFeatureGraphicPaths(projectId, locale).texts).toString("utf8");
    return sanitizeStoredFeatureGraphic(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function hasLocaleFeatureGraphic(projectId: string, locale: string): boolean {
  return listFiles(localeFeatureGraphicDir(projectId)).some((f) => f.name === `${locale}.jpg`);
}

/** Supprime la bannière rendue d'une langue (et ses textes). */
export function deleteLocaleFeatureGraphic(projectId: string, locale: string): void {
  const paths = localeFeatureGraphicPaths(projectId, locale);
  deleteFile(paths.image);
  deleteFile(paths.texts);
}

/**
 * Traduit titre + badges d'une bannière avec un prompt dédié qui connaît les
 * limites (titre ≤ 60, badge ≤ 32). Un échec, ou un élément manquant, retombe
 * sur le texte source: une langue n'est jamais bloquée pour ça.
 */
export async function translateFeatureGraphicTexts(
  texts: FeatureGraphicTexts,
  fromLocale: string,
  toLocale: string
): Promise<FeatureGraphicTexts> {
  if (toLocale === fromLocale || (!texts.headline && texts.badges.length === 0)) return texts;
  const prompt = await getPrompt("aso_translate_feature_graphic");
  const variables = {
    from_locale: fromLocale,
    to_locale: toLocale,
    max_headline: String(MAX_HEADLINE_LENGTH),
    max_badge: String(MAX_BADGE_LENGTH),
    count: String(texts.badges.length),
    texts_json: JSON.stringify(texts),
  };
  try {
    const raw = (await completeJSON(
      renderTemplate(prompt.system, variables),
      renderTemplate(prompt.user, variables),
      "feature_graphic_translate"
    )) as { headline?: unknown; badges?: unknown };
    const headline = typeof raw.headline === "string" ? raw.headline.trim() : "";
    const badges = Array.isArray(raw.badges) ? raw.badges : [];
    return sanitizeFeatureGraphicTexts({
      headline: texts.headline ? headline || texts.headline : "",
      badges: texts.badges.map((b, i) => {
        const t = badges[i];
        return typeof t === "string" && t.trim() ? t : b;
      }),
    });
  } catch {
    return texts;
  }
}

/**
 * Textes de la bannière pour une langue: titre = titre de la fiche (déjà
 * localisé) ou titre du modèle traduit; badges traduits. La langue source n'est
 * jamais traduite. Un échec de traduction retombe sur la langue source
 * (cf. translateFeatureGraphicTexts).
 */
export async function resolveFeatureGraphicTexts(opts: {
  template: FeatureGraphicTemplate;
  sourceLocale: string;
  locale: string;
  listing?: ListingHeadlineTexts | null;
}): Promise<FeatureGraphicTexts> {
  const { template, sourceLocale, locale } = opts;
  const custom = template.headlineSource === "custom";
  const translated = await translateFeatureGraphicTexts(
    { headline: custom ? template.headline : "", badges: template.badges },
    sourceLocale,
    locale
  );
  const headline = custom ? translated.headline : listingHeadline(template, opts.listing);
  return sanitizeFeatureGraphicTexts({ headline, badges: translated.badges });
}

function contentTypeFor(path: string): string {
  return /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";
}

export type LocaleFeatureGraphic = {
  locale: string;
  url: string;
  texts: FeatureGraphicTexts;
  manual: boolean;
};

/** Modèle + illustration chargés une fois pour rendre plusieurs langues. */
export type FeatureGraphicContext = {
  projectId: string;
  template: FeatureGraphicTemplate;
  artDataUrl: string;
  artHash: string;
};

export function loadFeatureGraphicContext(
  projectId: string,
  templateOverride?: FeatureGraphicTemplate
): FeatureGraphicContext {
  const template = templateOverride ?? readFeatureGraphicTemplate(projectId);
  if (!template) throw new Error("Banner template not configured.");
  const artPath = findFeatureGraphicArt(projectId);
  if (!artPath) throw new Error("Banner illustration missing: upload it first.");
  const art = readFile(artPath);
  return {
    projectId,
    template,
    artDataUrl: `data:${contentTypeFor(artPath)};base64,${art.toString("base64")}`,
    artHash: createHash("sha256").update(art).digest("hex"),
  };
}

export function featureGraphicFingerprint(
  ctx: FeatureGraphicContext,
  manual: boolean,
  listing?: ListingHeadlineTexts | null
): string {
  const source = featureGraphicFingerprintSource({
    template: ctx.template,
    artHash: ctx.artHash,
    manual,
    listing,
  });
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

/** Bannière d'une langue: absente, à jour ou périmée (modèle/illustration/titre changés). */
export function localeFeatureGraphicStatus(
  ctx: FeatureGraphicContext,
  locale: string,
  listing?: ListingHeadlineTexts | null
): { exists: boolean; stale: boolean; stored: StoredFeatureGraphic | null } {
  if (!hasLocaleFeatureGraphic(ctx.projectId, locale)) {
    return { exists: false, stale: false, stored: null };
  }
  const stored = readLocaleFeatureGraphic(ctx.projectId, locale);
  const stale =
    !stored || stored.fingerprint !== featureGraphicFingerprint(ctx, stored.manual, listing);
  return { exists: true, stale, stored };
}

/**
 * Textes à rendre pour une langue. `texts` fourni = édition manuelle. Sinon des
 * textes déjà édités à la main sont CONSERVÉS (sauf `resetManual`): régénérer
 * ne doit pas effacer une correction. Sinon: traduction depuis le modèle.
 */
export async function resolveLocaleFeatureGraphicTexts(
  ctx: FeatureGraphicContext,
  opts: {
    sourceLocale: string;
    locale: string;
    listing?: ListingHeadlineTexts | null;
    texts?: FeatureGraphicTexts;
    resetManual?: boolean;
  }
): Promise<{ texts: FeatureGraphicTexts; manual: boolean }> {
  if (opts.texts) return { texts: sanitizeFeatureGraphicTexts(opts.texts), manual: true };
  if (!opts.resetManual) {
    const stored = readLocaleFeatureGraphic(ctx.projectId, opts.locale);
    if (stored?.manual) {
      return { texts: { headline: stored.headline, badges: stored.badges }, manual: true };
    }
  }
  const texts = await resolveFeatureGraphicTexts({
    template: ctx.template,
    sourceLocale: opts.sourceLocale,
    locale: opts.locale,
    listing: opts.listing,
  });
  return { texts, manual: false };
}
