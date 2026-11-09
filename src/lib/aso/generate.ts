import { completeJSON } from "@/lib/ai/providers";
import { STORE_LABELS } from "@/lib/constants";
import { missingLegalLines, type LegalLabels, type LegalLinks } from "@/lib/legal-links";
import type { StorePlatform } from "@/types";

import { STORE_LIMITS } from "./limits";
import { getPrompt, renderTemplate } from "./prompts";
import type { AsoListingOutput, KeywordEntry } from "./types";

export { STORE_LIMITS } from "./limits";

function truncate(value: unknown, max: number): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

/** Le champ keywords se tronque à la dernière virgule pour ne pas couper un mot. */
function truncateKeywords(value: unknown, max: number): string {
  const s = truncate(value, max);
  if (typeof value === "string" && value.trim().length <= max) return s;
  const lastComma = s.lastIndexOf(",");
  return lastComma > 0 ? s.slice(0, lastComma) : s;
}

/**
 * Génère la fiche d'une locale à partir de la base de mots clés fournie.
 * Keyword-only: les mots clés sont l'UNIQUE source de contenu et doivent être
 * réutilisés tels quels par le modèle. Les features utilisateur y sont déjà
 * fusionnées en tête (mergeFeatureKeywords, en amont), pas de paramètre séparé.
 */
/** EULA standard exigé par Apple en bas de description sur les fiches App Store. */
export const APPLE_EULA_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

/**
 * Garantit les lignes légales en fin de description, sans doublon: une ligne
 * `label: url` pour le site, la privacy policy et les conditions d'utilisation
 * (chacune seulement si son URL est fournie), et, sur App Store, la ligne EULA
 * Apple obligatoire. Chaque ligne n'est ajoutée que si son URL n'y figure PAS
 * déjà (correspondance exacte, voir containsUrl). Le corps est tronqué pour que
 * le suffixe ne dépasse jamais `maxLength` (les limites stores sont dures, le
 * suffixe n'est jamais coupé). Idempotent: rappelée sur une description déjà
 * complète, elle la renvoie inchangée. Sert de filet côté génération ET
 * régénération.
 */
export function ensureLegalLines(
  description: string,
  store: StorePlatform,
  links: LegalLinks,
  labels: Partial<LegalLabels> = {},
  maxLength: number = STORE_LIMITS.description
): string {
  const lines = missingLegalLines(description, links, labels);
  if (store === "appstore" && !description.includes(APPLE_EULA_URL)) {
    lines.push(`EULA : ${APPLE_EULA_URL}`);
  }
  if (lines.length === 0) return description;
  const suffix = `\n\n${lines.join("\n")}`;
  return truncate(description, Math.max(0, maxLength - suffix.length)) + suffix;
}

function labelFrom(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export async function generateListingCopy(
  store: StorePlatform,
  app: { name: string; developer: string | null },
  locale: string,
  keywords: KeywordEntry[],
  links: LegalLinks = {}
): Promise<AsoListingOutput> {
  const keywordList = keywords.map((k) => k.keyword);
  const websiteUrl = (links.websiteUrl ?? "").trim();
  const privacyUrl = (links.privacyPolicyUrl ?? "").trim();
  const termsUrl = (links.termsUrl ?? "").trim();

  // Prompt éditable en DB (fallback embarqué). Une clé par store: les champs et
  // règles diffèrent (App Store vs Google Play). Les lignes légales sont dans
  // des blocs {{#if ...}} rendus seulement quand l'URL correspondante est
  // fournie — le modèle fournit les libellés traduits, le code ajoute les URL
  // exactes lui-même (ensureLegalLines).
  const prompt = await getPrompt(
    store === "appstore" ? "aso_generate_listing_appstore" : "aso_generate_listing_playstore"
  );
  const variables = {
    store_label: STORE_LABELS[store],
    locale,
    app_name: app.name,
    developer_suffix: app.developer ? ` (developer: ${app.developer})` : "",
    legal: websiteUrl || privacyUrl || termsUrl ? "1" : "",
    website: websiteUrl ? "1" : "",
    privacy: privacyUrl ? "1" : "",
    terms: termsUrl ? "1" : "",
    keyword_list: keywordList.map((k, i) => `${i + 1}. ${k}`).join("\n"),
  };

  const raw = (await completeJSON(
    renderTemplate(prompt.system, variables),
    renderTemplate(prompt.user, variables),
    "generate_listing"
  )) as Record<string, unknown>;

  // Lignes légales en fin de description: site, privacy policy, conditions
  // d'utilisation (URL exactes owned by code, libellés traduits fournis par le
  // modèle, repli anglais) + EULA Apple sur App Store. ensureLegalLines réserve
  // la place du suffixe (jamais coupé) et évite le doublon si le modèle a
  // désobéi et déjà mis une URL.
  const description = ensureLegalLines(
    truncate(raw.description, STORE_LIMITS.description),
    store,
    { websiteUrl, privacyPolicyUrl: privacyUrl, termsUrl },
    {
      website: labelFrom(raw, "websiteLabel"),
      privacy: labelFrom(raw, "privacyLabel"),
      terms: labelFrom(raw, "termsLabel"),
    }
  );

  // Les limites stores sont dures: tronque plutôt que d'échouer.
  return {
    title: truncate(raw.title, STORE_LIMITS.title),
    subtitle: store === "appstore" ? truncate(raw.subtitle, STORE_LIMITS.subtitle) : "",
    shortDescription:
      store === "playstore"
        ? truncate(raw.shortDescription, STORE_LIMITS.shortDescription)
        : "",
    description,
    keywords:
      store === "appstore" ? truncateKeywords(raw.keywords, STORE_LIMITS.keywords) : "",
  };
}
