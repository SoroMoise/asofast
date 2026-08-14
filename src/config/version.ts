/**
 * Version affichée en bas de la sidebar. Injectée au build par next.config.ts
 * (`env.NEXT_PUBLIC_APP_VERSION`, inlinée dans le bundle), donc fixe pour un
 * déploiement donné et incrémentée à chaque build. Repli "dev" en local, hors
 * `next build`, quand la variable n'est pas inlinée.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
