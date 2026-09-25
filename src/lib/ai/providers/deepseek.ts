import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { ensureJsonWord, parseJsonStripNul } from "./openai";

let client: OpenAI | null = null;

/**
 * Lazy DeepSeek client. SERVER ONLY. Throws if DEEPSEEK_API_KEY is unset.
 * L'API DeepSeek est compatible OpenAI: on réutilise le SDK `openai` avec une
 * autre baseURL, sans dépendance supplémentaire.
 */
export function getDeepSeek(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
    client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com",
      maxRetries: 5,
      timeout: 60_000,
    });
  }
  return client;
}

// Défaut deepseek-flash: le seul modèle DeepSeek à la fois JSON mode ET vision,
// et le moins cher. Override possible via l'env DEEPSEEK_MODEL (ex. deepseek-v4-pro
// pour la qualité, texte seulement).
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";

// La vision N'hérite PAS de DEEPSEEK_MODEL: deepseek-v4-pro n'a pas la vision et,
// au lieu de planter, répond "cannot read image" dans un JSON valide. Le modèle
// vision est donc explicite (override: DEEPSEEK_VISION_MODEL, qui doit supporter
// les images).
const DEEPSEEK_DEFAULT_VISION_MODEL = "deepseek-flash";

const MAX_OUTPUT_TOKENS = 8192;
const MAX_IMAGES = 6;

/**
 * `thinking` n'est pas dans les types du SDK OpenAI. Le thinking est ACTIF par
 * défaut côté DeepSeek: on le coupe (sinon ~10x de tokens de raisonnement
 * facturés pour une simple extraction, et `temperature` est ignorée).
 */
type DeepSeekParams = ChatCompletionCreateParamsNonStreaming & {
  thinking: { type: "disabled" };
};

/**
 * Un appel en JSON mode. La doc DeepSeek prévient que le JSON mode peut
 * "occasionnellement renvoyer un contenu vide": on réessaie une fois, puis on
 * échoue plutôt que de laisser un `{}` silencieux produire une fiche vide en aval.
 * `finish_reason=length` = sortie tronquée (JSON invalide): erreur explicite, un
 * retry redonnerait la même troncature.
 */
async function completeJSONText(params: DeepSeekParams): Promise<string> {
  const deepseek = getDeepSeek();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await deepseek.chat.completions.create(params);
    const choice = res.choices[0];
    if (choice?.finish_reason === "length") {
      throw new Error(
        `DeepSeek output truncated (max_tokens=${MAX_OUTPUT_TOKENS} reached), model=${params.model}`
      );
    }
    const text = choice?.message?.content;
    if (text && text.trim()) return text;
  }
  throw new Error(`DeepSeek returned empty content twice in JSON mode, model=${params.model}`);
}

/**
 * Équivalent de completeJSON côté DeepSeek: même signature, même parsing (retrait
 * des NUL réutilisé depuis le provider OpenAI). Pas de log d'usage: le `label`
 * du dispatcher n'est pas utilisé ici.
 */
export async function completeJSON(system: string, user: string): Promise<unknown> {
  const text = await completeJSONText({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: ensureJsonWord(system, user) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: MAX_OUTPUT_TOKENS,
    thinking: { type: "disabled" },
  });
  return parseJsonStripNul(text);
}

/**
 * Équivalent de completeJSONWithImages côté DeepSeek (vision). Les URLs http(s)
 * et les data URLs (captures uploadées) sont passées telles quelles dans
 * `image_url`, DeepSeek gère les deux.
 */
export async function completeJSONWithImages(
  system: string,
  text: string,
  imageUrls: string[]
): Promise<unknown> {
  const out = await completeJSONText({
    model: process.env.DEEPSEEK_VISION_MODEL ?? DEEPSEEK_DEFAULT_VISION_MODEL,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: ensureJsonWord(system, text) },
          ...imageUrls.slice(0, MAX_IMAGES).map((url) => ({
            type: "image_url" as const,
            image_url: { url, detail: "auto" as const },
          })),
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: MAX_OUTPUT_TOKENS,
    thinking: { type: "disabled" },
  });
  return parseJsonStripNul(out);
}
