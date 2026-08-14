/**
 * Langues effectivement générées par une exécution du pipeline ASO.
 *
 * Sans `locales` (CTA « Générer les fiches »): toutes les langues cibles.
 *
 * Avec `locales` (bouton « Regenerate this language »): la langue demandée, à
 * condition qu'elle soit une langue cible OU qu'une fiche existe déjà pour elle.
 * Les onglets de la fiche listent les langues GÉNÉRÉES, pas les langues cibles:
 * réduire sa sélection de langues cibles ne doit pas rendre les fiches déjà
 * générées non régénérables (sinon le bouton ne fait rien, silencieusement).
 */
export function resolveRequestedLocales(
  locales: string[] | undefined,
  targetLocales: string[],
  existingListingLocales: string[]
): string[] {
  if (!locales?.length) return targetLocales;
  const allowed = new Set([...targetLocales, ...existingListingLocales]);
  return locales.filter((l) => allowed.has(l));
}
