import { completeJSON } from "@/lib/ai/providers/openai";
import type { CopyOutput } from "@/lib/ai/types";
import { getPrompt, renderTemplate } from "@/lib/aso/prompts";
import { STORE_LABELS } from "@/lib/constants";
import type { AppMetadata } from "@/lib/scrapers";

/** Generate optimized ASO copy for an app, in the given target locale. */
export async function generateCopy(
  meta: AppMetadata,
  targetLocale: string
): Promise<CopyOutput> {
  const prompt = await getPrompt("aso_generate_copy");
  const variables = {
    store_label: STORE_LABELS[meta.store],
    target_locale: targetLocale,
    app_title: meta.title,
    developer: meta.developer ?? "unknown",
    categories: meta.categories.join(", ") || "unknown",
    description: meta.description || "(none)",
  };

  return (await completeJSON(
    renderTemplate(prompt.system, variables),
    renderTemplate(prompt.user, variables)
  )) as CopyOutput;
}
