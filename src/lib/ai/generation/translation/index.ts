import { completeJSON } from "@/lib/ai/providers/openai";
import type { TranslationOutput } from "@/lib/ai/types";
import { getPrompt, renderTemplate } from "@/lib/aso/prompts";
import type { AppMetadata } from "@/lib/scrapers";

/**
 * Translate and localize an app listing from its source locale into a target
 * locale (ASO-aware — not a literal word-for-word translation).
 */
export async function generateTranslation(
  meta: AppMetadata,
  sourceLocale: string,
  targetLocale: string
): Promise<TranslationOutput> {
  const prompt = await getPrompt("aso_translate_listing");
  const variables = {
    source_locale: sourceLocale,
    target_locale: targetLocale,
    title: meta.title,
    subtitle: meta.subtitle ?? "",
    description: meta.description || "(none)",
  };

  const out = (await completeJSON(
    renderTemplate(prompt.system, variables),
    renderTemplate(prompt.user, variables)
  )) as TranslationOutput;
  return { ...out, locale: targetLocale };
}
