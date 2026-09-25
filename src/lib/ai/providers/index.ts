import * as anthropic from "./anthropic";
import * as deepseek from "./deepseek";
import * as openai from "./openai";

/**
 * AI_PROVIDER choisit le provider LLM: "openai" | "anthropic" | "deepseek". Non
 * requise — toute valeur absente ou inconnue retombe sur openai (le comportement
 * historique, avant l'ajout de Claude et DeepSeek).
 */
function activeProvider(): "openai" | "anthropic" | "deepseek" {
  switch (process.env.AI_PROVIDER) {
    case "anthropic":
      return "anthropic";
    case "deepseek":
      return "deepseek";
    default:
      return "openai";
  }
}

/**
 * `label` nomme l'étape appelante dans le log d'usage (Claude uniquement, les
 * providers OpenAI et DeepSeek l'ignorent).
 */
export function completeJSON(system: string, user: string, label?: string): Promise<unknown> {
  switch (activeProvider()) {
    case "anthropic":
      return anthropic.completeJSON(system, user, label);
    case "deepseek":
      return deepseek.completeJSON(system, user);
    default:
      return openai.completeJSON(system, user);
  }
}

export function completeJSONWithImages(
  system: string,
  text: string,
  imageUrls: string[],
  label?: string
): Promise<unknown> {
  switch (activeProvider()) {
    case "anthropic":
      return anthropic.completeJSONWithImages(system, text, imageUrls, label);
    case "deepseek":
      return deepseek.completeJSONWithImages(system, text, imageUrls);
    default:
      return openai.completeJSONWithImages(system, text, imageUrls);
  }
}
