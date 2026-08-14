/** Limites de caracteres des stores. */
export const STORE_LIMITS = {
  title: 30,
  subtitle: 30, // iOS
  shortDescription: 80, // Android
  description: 4000,
  keywords: 100, // champ keywords iOS
} as const;
