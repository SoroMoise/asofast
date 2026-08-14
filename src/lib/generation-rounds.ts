/**
 * Calculs purs de l'orchestration en deux rounds du CTA de génération
 * (`generate-cta.tsx`): découpe en lots, dénominateur de la barre d'avancement.
 * Isolés du composant parce qu'une erreur d'arithmétique y est invisible à la
 * relecture, et parce que le composant est déjà long.
 */

/**
 * Round 1 (listings): I/O-bound, chaque langue attend OpenAI. Le plafond est le
 * rate limit du compte, pas le CPU. 6 lambdas × 4 langues = 24 appels simultanés
 * au pire. Valeurs inchangées par le passage en deux rounds.
 */
export const ASO_BATCH_SIZE = 4;
export const ASO_BATCH_CONCURRENCY = 6;

/**
 * Round 2 (screenshots): CPU-bound, satori et resvg rasterisent en synchrone et
 * bloquent la boucle d'évènements. Le plafond est le vCPU de la lambda. On
 * privilégie donc les lambdas (6) sur la concurrence interne: lots de 2 langues,
 * concurrence interne 2 (cf. SHOT_LOCALE_CONCURRENCY dans actions.ts), soit une
 * seule vague par lot et 12 rendus simultanés au pire, répartis sur 8 vCPU.
 */
export const SHOTS_BATCH_SIZE = 2;
export const SHOTS_BATCH_CONCURRENCY = 6;

/** Découpe `items` en lots de `size` (le dernier peut être plus court). */
export function splitBatches(items: string[], size: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Dénominateur de la barre d'avancement.
 *
 * Les deux rounds étant séquentiels, le nombre d'étapes screenshots n'est connu
 * qu'à la barrière: seules les langues dont le listing a réussi passent au round
 * 2. `survivorCount` vaut `null` tant qu'on ne le sait pas (avant le round 1, ou
 * quand la fiche n'est pas demandée), auquel cas on majore par `localeCount`.
 * Sans ce recalcul, la barre n'atteindrait jamais 100% dès qu'une langue rate.
 */
export function computeTotalSteps(input: {
  localeCount: number;
  includeAso: boolean;
  includeShots: boolean;
  survivorCount: number | null;
}): number {
  const asoSteps = input.includeAso ? input.localeCount : 0;
  if (!input.includeShots) return asoSteps;
  return asoSteps + (input.survivorCount ?? input.localeCount);
}
