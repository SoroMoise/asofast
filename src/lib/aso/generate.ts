import { completeJSON } from "@/lib/ai/providers";
import { STORE_LABELS } from "@/lib/constants";
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
const DEFAULT_PRIVACY_LABEL = "Privacy Policy";

/** EULA standard exigé par Apple en bas de description sur les fiches App Store. */
export const APPLE_EULA_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

/**
 * Garantit les lignes légales en fin de description, sans doublon: la ligne
 * privacy policy (`label: url`) quand une URL est fournie, et, sur App Store, la
 * ligne EULA Apple obligatoire. Chaque ligne n'est ajoutée que si son URL n'y
 * figure PAS déjà. Le corps est tronqué pour que le suffixe ne dépasse jamais
 * `maxLength` (les limites stores sont dures, le suffixe n'est jamais coupé).
 * Idempotent: rappelée sur une description déjà complète, elle la renvoie
 * inchangée. Sert de filet côté génération ET régénération.
 */
export function ensureLegalLines(
  description: string,
  store: StorePlatform,
  privacyPolicyUrl: string,
  label: string = DEFAULT_PRIVACY_LABEL,
  maxLength: number = STORE_LIMITS.description
): string {
  const url = privacyPolicyUrl.trim();
  const lines: string[] = [];
  if (url && !description.includes(url)) lines.push(`${label}: ${url}`);
  if (store === "appstore" && !description.includes(APPLE_EULA_URL)) {
    lines.push(`EULA : ${APPLE_EULA_URL}`);
  }
  if (lines.length === 0) return description;
  const suffix = `\n\n${lines.join("\n")}`;
  return truncate(description, Math.max(0, maxLength - suffix.length)) + suffix;
}

export async function generateListingCopy(
  store: StorePlatform,
  app: { name: string; developer: string | null },
  locale: string,
  keywords: KeywordEntry[],
  privacyPolicyUrl = ""
): Promise<AsoListingOutput> {
  const keywordList = keywords.map((k) => k.keyword);
  const privacyUrl = privacyPolicyUrl.trim();

  // Prompt éditable en DB (fallback embarqué). Une clé par store: les champs et
  // règles diffèrent (App Store vs Google Play). Les lignes privacy sont dans un
  // bloc {{#if privacy}} rendu seulement quand une URL est fournie — le code
  // fournit le libellé traduit et ajoute l'URL exacte lui-même (ensureLegalLines).
  const prompt = await getPrompt(
    store === "appstore" ? "aso_generate_listing_appstore" : "aso_generate_listing_playstore"
  );
  const variables = {
    store_label: STORE_LABELS[store],
    locale,
    app_name: app.name,
    developer_suffix: app.developer ? ` (developer: ${app.developer})` : "",
    privacy: privacyUrl ? "1" : "",
    keyword_list: keywordList.map((k, i) => `${i + 1}. ${k}`).join("\n"),
  };

  const raw = (await completeJSON(
    renderTemplate(prompt.system, variables),
    renderTemplate(prompt.user, variables)
  )) as Record<string, unknown>;

  // Lignes légales en fin de description: privacy policy (URL exacte owned by
  // code, libellé traduit fourni par le modèle) + EULA Apple sur App Store.
  // ensureLegalLines réserve la place du suffixe (jamais coupé) et évite le
  // doublon si le modèle a désobéi et déjà mis une URL.
  const label =
    (typeof raw.privacyLabel === "string" && raw.privacyLabel.trim()) ||
    DEFAULT_PRIVACY_LABEL;
  const description = ensureLegalLines(
    truncate(raw.description, STORE_LIMITS.description),
    store,
    privacyUrl,
    label
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
