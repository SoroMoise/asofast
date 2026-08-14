/**
 * Application 100% locale : aucune variable d'environnement publique n'est
 * requise. Les secrets (cle OpenAI, cle de chiffrement des credentials stores)
 * sont lus cote serveur uniquement, depuis .env.local.
 */

export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export const env = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_APP_VERSION: APP_VERSION,
};
