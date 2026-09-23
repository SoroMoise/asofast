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

export function completeJSON(system: string, user: string): Promise<unknown> {
  const provider = activeProvider() === "anthropic" ? anthropic : openai;
  return provider.completeJSON(system, user);
}

export function completeJSONWithImages(
  system: string,
  text: string,
  imageUrls: string[]
): Promise<unknown> {
  const provider = activeProvider() === "anthropic" ? anthropic : openai;
  return provider.completeJSONWithImages(system, text, imageUrls);
}
