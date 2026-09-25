import * as anthropic from "./anthropic";
import * as openai from "./openai";

/**
 * AI_PROVIDER choisit le provider LLM: "openai" | "anthropic". Non requise —
 * toute valeur absente ou différente de "anthropic" retombe sur openai (le
 * comportement historique, avant l'ajout de Claude).
 */
function activeProvider(): "openai" | "anthropic" {
  return process.env.AI_PROVIDER === "anthropic" ? "anthropic" : "openai";
}

/**
 * `label` nomme l'étape appelante dans le log d'usage (Claude uniquement, le
 * provider OpenAI l'ignore).
 */
export function completeJSON(system: string, user: string, label?: string): Promise<unknown> {
  return activeProvider() === "anthropic"
    ? anthropic.completeJSON(system, user, label)
    : openai.completeJSON(system, user);
}

export function completeJSONWithImages(
  system: string,
  text: string,
  imageUrls: string[],
  label?: string
): Promise<unknown> {
  return activeProvider() === "anthropic"
    ? anthropic.completeJSONWithImages(system, text, imageUrls, label)
    : openai.completeJSONWithImages(system, text, imageUrls);
}
