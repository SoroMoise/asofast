import { completeJSON } from "@/lib/ai/providers";
import { STORE_LABELS } from "@/lib/constants";
import type { AppMetadata } from "@/lib/scrapers";

import { getPrompt, renderTemplate } from "./prompts";

/**
 * Extraction de mots clés par LLM (prompt éditable dans la table `prompts`,
 * clé `aso_extract_keywords`). Renvoie keyword -> poids (1-10), format
 * compatible avec mergeKeywords.
 */
export async function extractKeywordsLLM(
  meta: Pick<
    AppMetadata,
    "store" | "title" | "subtitle" | "description"
  > & { shortDescription?: string | null }
): Promise<Map<string, number>> {
  const prompt = await getPrompt("aso_extract_keywords");

  // Google Play: le "summary" scrapé sert de short description; l'App Store
  // n'expose pas de short description (champ vide).
  const variables = {
    store: STORE_LABELS[meta.store],
    title: meta.title ?? "",
    subtitle: meta.subtitle ?? "",
    short_description:
      meta.shortDescription ?? (meta.store === "playstore" ? meta.subtitle ?? "" : ""),
    long_description: (meta.description ?? "").slice(0, 6000),
  };

  const raw = (await completeJSON(
    renderTemplate(prompt.system, variables),
    renderTemplate(prompt.user, variables),
    "extract_keywords"
  )) as { keywords?: unknown };

  const out = new Map<string, number>();
  if (Array.isArray(raw.keywords)) {
    for (const entry of raw.keywords) {
      const e = entry as { keyword?: unknown; weight?: unknown };
      const keyword =
        typeof e.keyword === "string" ? e.keyword.trim().toLowerCase() : "";
      if (!keyword) continue;
      const weight =
        typeof e.weight === "number" && Number.isFinite(e.weight)
          ? Math.min(10, Math.max(1, Math.round(e.weight)))
          : 1;
      out.set(keyword, Math.max(out.get(keyword) ?? 0, weight));
    }
  }
  if (out.size === 0) {
    throw new Error("LLM extraction: no keyword returned.");
  }
  return out;
}
