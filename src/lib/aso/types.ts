import type { StorePlatform } from "@/types";

/** App validée à l'étape lookup du wizard (aussi stockée dans projects.competitors). */
export type AppRef = {
  store: StorePlatform;
  identifier: string;
  name: string;
  developer: string | null;
  icon: string | null;
};

/** Un mot clé de la base commune, avec sa force (nb de compétiteurs + occurrences). */
export type KeywordEntry = {
  keyword: string;
  competitors: number;
  occurrences: number;
};

/** Fiche générée pour une locale (avant persistance dans listings). */
export type AsoListingOutput = {
  title: string;
  subtitle: string;
  shortDescription: string;
  description: string;
  keywords: string;
};
