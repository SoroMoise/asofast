import type { AppRef, KeywordEntry } from "./types";

/**
 * Fusionne les mots clés de plusieurs compétiteurs: union triée par
 * (nb de compétiteurs qui l'utilisent, puis occurrences totales).
 */
export function mergeKeywords(
  perCompetitor: Map<string, number>[],
  top = 30
): KeywordEntry[] {
  const merged = new Map<string, KeywordEntry>();
  for (const counts of perCompetitor) {
    for (const [keyword, occurrences] of counts) {
      const entry = merged.get(keyword) ?? { keyword, competitors: 0, occurrences: 0 };
      entry.competitors += 1;
      entry.occurrences += occurrences;
      merged.set(keyword, entry);
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.competitors - a.competitors || b.occurrences - a.occurrences)
    .slice(0, top);
}

/**
 * Cle stable de l'ensemble des concurrents (identifiants store tries). Sert a
 * invalider le cache de la base anglaise: meme ensemble = meme cle = cache
 * reutilisable; ajout ou retrait d'un concurrent = cle differente = recalcul.
 */
export function competitorSetKey(competitors: AppRef[]): string {
  return competitors
    .map((c) => c.identifier)
    .sort()
    .join("|");
}

/**
 * Fusionne les features saisies par l'utilisateur dans une base de mots cles, en
 * tete (l'ordre = importance pour la generation), sans appel LLM. Dedoublonnage
 * insensible a la casse: une feature deja presente dans la base n'est pas ajoutee.
 * Poids a 0 (ce ne sont pas des mots cles derives des concurrents). Les features
 * sont fusionnees BRUTES: runLocalePipeline traduit l'ensemble (features + base) en
 * une seule passe apres ce merge, pour les locales non anglaises.
 */
export function mergeFeatureKeywords(
  base: KeywordEntry[],
  features: string[]
): KeywordEntry[] {
  const present = new Set(base.map((k) => k.keyword.toLowerCase()));
  const featureEntries: KeywordEntry[] = [];
  for (const raw of features) {
    const keyword = raw.trim().toLowerCase().slice(0, 60);
    if (!keyword || present.has(keyword)) continue;
    present.add(keyword);
    featureEntries.push({ keyword, competitors: 0, occurrences: 0 });
  }
  return [...featureEntries, ...base];
}
