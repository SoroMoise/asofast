import type { ScreenshotStyle } from "@/lib/ai/types";

/**
 * Valide un hex #rrggbb. Source unique réutilisée par style.ts (validation
 * d'extraction) et par la validation serveur des couleurs choisies. Module sans
 * dépendance runtime (import de type erased) => testable en import relatif.
 */
export const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Applique les couleurs choisies par l'utilisateur (page projet) par-dessus le
 * style calculé (extrait des concurrents ou défaut). Chaque couleur est
 * optionnelle: absente/nulle/non-hex => on garde le style calculé. Fixer le fond
 * abandonne le dégradé auto (fond PLEIN), comportement attendu quand on choisit
 * une couleur unique. Pur: testable sans DB ni réseau.
 */
export function applyColorOverrides(
  style: ScreenshotStyle,
  overrides: { backgroundColor?: string | null; textColor?: string | null }
): ScreenshotStyle {
  let next = style;
  if (typeof overrides.backgroundColor === "string" && HEX.test(overrides.backgroundColor)) {
    next = { ...next, backgroundColor: overrides.backgroundColor, backgroundGradientTo: null };
  }
  if (typeof overrides.textColor === "string" && HEX.test(overrides.textColor)) {
    next = { ...next, textColor: overrides.textColor };
  }
  return next;
}
