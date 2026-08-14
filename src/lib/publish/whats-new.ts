/** Longueur max du champ whatsNew d'une localisation App Store. */
export const WHATS_NEW_MAX = 4000;

/** Traduit un texte de release notes vers une locale (injecté pour la testabilité). */
export type WhatsNewTranslator = (text: string, targetLocale: string) => Promise<string>;

/**
 * Résout les release notes d'une locale: verbatim quand la langue cible partage
 * le sous-tag de langue de la source (pas de traduction inutile), sinon traduit.
 * Résultat tronqué à WHATS_NEW_MAX. Chaîne vide quand la source est vide.
 */
export async function resolveLocaleWhatsNew(
  source: string,
  sourceLocale: string,
  targetLocale: string,
  translate: WhatsNewTranslator
): Promise<string> {
  const clean = (source ?? "").trim();
  if (!clean) return "";
  const sameLang =
    targetLocale.split("-")[0].toLowerCase() === sourceLocale.split("-")[0].toLowerCase();
  if (sameLang) return clean.slice(0, WHATS_NEW_MAX);
  // La traduction est sur le chemin critique du publish (mapWithConcurrency =
  // Promise.all: un throw abandonne tout le lot). On avale l'échec et on renvoie
  // "": l'appelant saute whatsNew pour cette locale, le reste de la fiche publie.
  try {
    const text = await translate(clean, targetLocale);
    return text.slice(0, WHATS_NEW_MAX);
  } catch {
    return "";
  }
}
