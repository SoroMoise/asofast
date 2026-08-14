import { fetchAppMetadata } from "@/lib/scrapers";
import type { StorePlatform } from "@/types";

import { generateListingCopy } from "./generate";
import { competitorSetKey, mergeFeatureKeywords, mergeKeywords } from "./keywords";
import { extractKeywordsLLM } from "./keywords-llm";
import { fetchOptionsForLocale, isEnglishLocale } from "./locale-map";
import { translateKeywords } from "./translate";
import type { AppRef, AsoListingOutput, KeywordEntry } from "./types";

export type LocaleResult = {
  locale: string;
  keywordBase: KeywordEntry[];
  listing: AsoListingOutput;
};

/** Locale utilisée pour le repli anglais (fiche par défaut d'un compétiteur). */
const ENGLISH_FALLBACK_LOCALE = "en-US";

/**
 * Extraction LLM des mots clés d'un compétiteur (prompt éditable en DB). Sur
 * échec (OpenAI déjà retenté 5×), on saute ce compétiteur (Map vide) plutôt que
 * de dégrader vers une heuristique.
 */
async function extractCompetitorKeywords(
  meta: Awaited<ReturnType<typeof fetchAppMetadata>>
): Promise<Map<string, number>> {
  try {
    return await extractKeywordsLLM(meta);
  } catch {
    return new Map();
  }
}

/**
 * Récupère les fiches des compétiteurs dans `fetchLocale` et en extrait la base
 * de mots clés fusionnée. Renvoie aussi `fetched` (nb de fiches récupérées) pour
 * distinguer « rien récupéré » (app absente du storefront) de « fiche récupérée
 * mais aucun mot clé extrait » dans les messages d'erreur.
 */
async function keywordsFromCompetitors(
  store: StorePlatform,
  competitors: AppRef[],
  fetchLocale: string
): Promise<{ base: KeywordEntry[]; fetched: number }> {
  const settled = await Promise.allSettled(
    competitors.map((c) =>
      fetchAppMetadata(store, c.identifier, fetchOptionsForLocale(store, fetchLocale))
    )
  );
  const metas = settled
    .filter(
      (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchAppMetadata>>> =>
        s.status === "fulfilled"
    )
    .map((s) => s.value);
  const base = mergeKeywords(await Promise.all(metas.map((m) => extractCompetitorKeywords(m))));
  return { base, fetched: metas.length };
}

/**
 * Base de mots cles anglaise canonique des concurrents. Extraite UNE fois puis
 * cachee sur le projet (colonnes competitor_keywords_en / competitor_keywords_key).
 * Reutilisee tant que l'ensemble des concurrents ne change pas. `recomputed` dit a
 * l'appelant s'il doit persister la nouvelle base.
 */
export async function resolveEnglishBase(
  store: StorePlatform,
  competitors: AppRef[],
  cachedBase: KeywordEntry[],
  cachedKey: string | null
): Promise<{ base: KeywordEntry[]; key: string; recomputed: boolean }> {
  const key = competitorSetKey(competitors);
  if (cachedKey === key && cachedBase.length > 0) {
    return { base: cachedBase, key, recomputed: false };
  }
  const { base } = await keywordsFromCompetitors(store, competitors, ENGLISH_FALLBACK_LOCALE);
  return { base, key, recomputed: true };
}

/**
 * Construit la base BRUTE de mots cles d'une locale (aucune traduction ici, elle
 * est faite en une passe par runLocalePipeline apres fusion des features).
 * 1. Locale anglaise: la base canonique EST l'extraction en-US cachee, on la reutilise.
 * 2. Extraction native de la locale cible; si non vide, on la prend.
 * 3. Repli: base anglaise cachee renvoyee TELLE QUELLE (non traduite).
 * 4. Echec seulement si ni natif ni base anglaise ne donnent rien.
 */
async function buildKeywordBase(
  store: StorePlatform,
  competitors: AppRef[],
  locale: string,
  englishBase: KeywordEntry[]
): Promise<KeywordEntry[]> {
  if (isEnglishLocale(locale) && englishBase.length > 0) {
    return englishBase;
  }

  const primary = await keywordsFromCompetitors(store, competitors, locale);
  if (primary.base.length > 0) return primary.base;

  if (englishBase.length > 0) return englishBase;

  if (primary.fetched === 0) {
    throw new Error(
      `No competitor listing could be fetched in ${locale} or English (${competitors.length} attempted).`
    );
  }
  throw new Error(
    `No keyword extracted from competitors in ${locale} (English fallback also empty).`
  );
}

/**
 * Traduit la base fusionnee vers la locale cible. Degrade sur echec (OpenAI deja
 * retente 5x) ou reponse vide en renvoyant la base non traduite, pour ne pas
 * bloquer la locale (meme logique degrade-sans-echec que extractCompetitorKeywords).
 * L'anglais peut alors fuir sur une fiche non anglaise; choix assume (spec Q10).
 */
async function translateBaseOrDegrade(
  base: KeywordEntry[],
  locale: string
): Promise<KeywordEntry[]> {
  try {
    const translated = await translateKeywords(base, locale);
    if (translated.length === 0) {
      console.warn(
        `[aso pipeline] ${locale}: translation returned empty; degrading to untranslated base (${base.length} keyword(s)). English may appear on a non-English listing.`
      );
      return base;
    }
    return translated;
  } catch (err) {
    console.warn(
      `[aso pipeline] ${locale}: translation failed, degrading to untranslated base (${base.length} keyword(s)). English may appear on a non-English listing.`,
      err
    );
    return base;
  }
}

/**
 * Pipeline ASO pour une locale:
 * 1. base BRUTE de mots cles competiteurs (native ou repli anglais cache) via
 *    buildKeywordBase, fusion des features brutes, puis UNE passe de traduction
 *    vers la locale cible (sauf locales anglaises ou override manuel)
 * 2. generation de la fiche via LLM avec ces mots cles stricts
 */
export async function runLocalePipeline(
  store: StorePlatform,
  app: {
    name: string;
    developer: string | null;
    features?: string[];
    privacyPolicyUrl?: string;
  },
  competitors: AppRef[],
  locale: string,
  /** Base anglaise canonique (cachee), fournie par l'appelant pour eviter la
   *  re-extraction par langue de repli. Voir resolveEnglishBase. */
  englishBase: KeywordEntry[],
  keywordOverride?: KeywordEntry[]
): Promise<LocaleResult> {
  // Override edite a la main: utilise TEL QUEL, jamais auto-traduit (l'utilisateur
  // a compose sa liste dans la langue cible). Sinon: base brute (native ou repli
  // en-US) + features brutes en tete, puis UNE passe de traduction vers la cible
  // (sauf locale anglaise). generateListingCopy reutilise ces mots cles tels quels.
  let keywordBase: KeywordEntry[];
  if (keywordOverride && keywordOverride.length > 0) {
    keywordBase = keywordOverride;
  } else {
    const base = await buildKeywordBase(store, competitors, locale, englishBase);
    const merged = mergeFeatureKeywords(base, app.features ?? []);
    keywordBase = isEnglishLocale(locale)
      ? merged
      : await translateBaseOrDegrade(merged, locale);
  }

  const listing = await generateListingCopy(
    store,
    app,
    locale,
    keywordBase,
    app.privacyPolicyUrl ?? ""
  );
  return { locale, keywordBase, listing };
}
