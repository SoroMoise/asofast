import { completeJSON } from "@/lib/ai/providers";

import { getPrompt, renderTemplate } from "./prompts";
import type { KeywordEntry } from "./types";

/**
 * Normalise une base de mots clés déjà fusionnée (mots clés natifs des
 * compétiteurs + features brutes de l'utilisateur, dans n'importe quelle langue
 * source) vers la locale cible via OpenAI. Appelée sans condition par
 * runLocalePipeline pour chaque locale non anglaise, une seule fois sur
 * l'ensemble fusionné, pour que la génération reçoive toujours une base déjà
 * dans la bonne langue (generate.ts réutilise les mots clés TELS QUELS, sans
 * les traduire).
 *
 * Conserve le signal de ranking (competitors/occurrences) de chaque entrée:
 * seule la chaîne `keyword` change. Alignement par index; les doublons de
 * traduction sont fusionnés sur la 1re occurrence (la mieux classée, l'entrée
 * étant triée par importance décroissante).
 */
export async function translateKeywords(
  keywords: KeywordEntry[],
  targetLocale: string
): Promise<KeywordEntry[]> {
  if (keywords.length === 0) return [];

  const prompt = await getPrompt("aso_translate_keywords");
  const variables = {
    target_locale: targetLocale,
    count: String(keywords.length),
    keyword_list: keywords.map((k, i) => `${i + 1}. ${k.keyword}`).join("\n"),
  };

  const raw = (await completeJSON(
    renderTemplate(prompt.system, variables),
    renderTemplate(prompt.user, variables),
    "translate_keywords"
  )) as { translations?: unknown };
  const translations = Array.isArray(raw.translations) ? raw.translations : [];

  const out: KeywordEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < keywords.length; i++) {
    const t = translations[i];
    const keyword = typeof t === "string" ? t.trim().toLowerCase() : "";
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({ ...keywords[i], keyword });
  }
  return out;
}

/**
 * Traduit les release notes "What's New" App Store vers la langue cible via
 * OpenAI. Préserve les sauts de ligne et le sens; les noms de marque restent
 * tels quels. Renvoie une chaîne vide si le modèle ne renvoie rien: l'appelant
 * saute alors whatsNew pour cette locale, plutôt que d'y publier la langue
 * source (des notes en anglais sur une fiche française).
 */
export async function translateWhatsNew(text: string, targetLocale: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";

  const prompt = await getPrompt("aso_translate_whats_new");
  const variables = { target_locale: targetLocale, text: clean };

  const raw = (await completeJSON(
    renderTemplate(prompt.system, variables),
    renderTemplate(prompt.user, variables),
    "translate_whats_new"
  )) as { text?: unknown };
  return typeof raw.text === "string" ? raw.text.trim() : "";
}
