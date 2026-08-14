import type { StorePlatform } from "@/types";

import type { PublishScope } from "./types";

/** Tout publier: le comportement d'avant l'option, et le défaut partout. */
export const FULL_SCOPE: PublishScope = {
  text: true,
  screenshots: true,
  storeAssets: true,
  privacyAndWhatsNew: true,
};

/**
 * Lit le `scope` du body de publication. Absent, partiel ou mal typé => `true`,
 * pour qu'un appel qui ignore l'option publie tout comme avant. SEUL un `false`
 * explicite retire un bloc: un `0`, un `"false"` ou un `null` ne doivent pas
 * amputer une publication par accident.
 */
export function normalizePublishScope(raw: unknown): PublishScope {
  if (typeof raw !== "object" || raw === null) return { ...FULL_SCOPE };
  const o = raw as Record<string, unknown>;
  return {
    text: o.text !== false,
    screenshots: o.screenshots !== false,
    storeAssets: o.storeAssets !== false,
    privacyAndWhatsNew: o.privacyAndWhatsNew !== false,
  };
}

/**
 * Scope qui ne publierait rien POUR CE STORE. Le serveur s'en sert au lieu de
 * faire confiance au bouton désactivé côté client.
 *
 * Chaque bloc optionnel ne compte que sur SON store. `storeAssets`: l'icône App
 * Store vient du binaire, pas de la fiche, donc le chemin App Store ne lit
 * jamais ce bloc (un test aveugle au store laisserait passer
 * `{text:false, screenshots:false, storeAssets:true}` sur iOS en n'envoyant
 * strictement rien). Symétriquement `privacyAndWhatsNew` n'existe que sur App
 * Store: sur Play il ne sauve pas un scope par ailleurs vide.
 */
export function isEmptyScope(scope: PublishScope, store: StorePlatform): boolean {
  if (scope.text || scope.screenshots) return false;
  return store === "appstore" ? !scope.privacyAndWhatsNew : !scope.storeAssets;
}
