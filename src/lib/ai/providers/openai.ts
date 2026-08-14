import OpenAI from "openai";

let client: OpenAI | null = null;

/** Lazy OpenAI client. SERVER ONLY. Throws if OPENAI_API_KEY is unset. */
export function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    // Le fan-out des lots (générer toutes les langues en parallèle) tape OpenAI
    // avec beaucoup d'appels concurrents: on relève maxRetries pour absorber les
    // 429/5xx (le SDK fait le backoff exponentiel avec jitter tout seul). Timeout
    // explicite pour qu'une requête pendue ne bloque pas un lot entier.
    client = new OpenAI({ apiKey, maxRetries: 5, timeout: 60_000 });
  }
  return client;
}

// Défaut gpt-4o (qualité) au lieu de gpt-4o-mini: la marge (COGS ~1% du prix)
// laisse la place, le gain qualité de la génération de fiches prime. Couvre TOUS
// les appels (extraction, génération, traduction) + la vision par repli. Override
// possible via l'env OPENAI_MODEL / OPENAI_VISION_MODEL.
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

/**
 * Le JSON mode de la Responses API exige le mot "json" dans les messages
 * input (le paramètre `instructions` ne compte pas). Les prompts étant
 * éditables en DB, on garantit la contrainte ici plutôt que dans chaque prompt.
 */
function ensureJsonWord(system: string, user: string): string {
  return /json/i.test(system) || /json/i.test(user)
    ? user
    : `${user}\n\nRespond only in JSON.`;
}

/** Caractère NUL (U+0000). Exprimé par son point de code, jamais en octet litéral
 *  dans la source (un NUL brut y est fragile: retiré par éditeurs/formatteurs). */
const NUL = String.fromCharCode(0);

/**
 * Parse la sortie JSON du modèle en retirant les caractères NUL (U+0000) de
 * TOUTE valeur chaîne. Le reviver descend récursivement, donc couvre aussi les
 * tableaux/objets imbriqués (ex. keyword_base). Un modèle émet parfois un NUL
 * (observé sur kn-IN); JSON.parse en fait un vrai U+0000, que Postgres refuse au
 * stockage ("unsupported Unicode escape sequence: \\u0000 cannot be converted to
 * text"), ce qui fait échouer l'upsert de la fiche ENTIÈRE. On nettoie ici, à
 * l'unique frontière où la sortie LLM entre dans le système (tous les appels
 * passent par completeJSON / completeJSONWithImages), pour couvrir tous les
 * champs et toutes les tables en aval. Seul U+0000 est retiré: les autres
 * contrôles C0 sont légaux en texte et en jsonb Postgres, ne pas sur-nettoyer.
 */
export function parseJsonStripNul(text: string): unknown {
  return JSON.parse(text, (_key, value) =>
    typeof value === "string" && value.includes(NUL) ? value.split(NUL).join("") : value
  );
}

/**
 * Responses API call constrained to a JSON object output and parsed.
 * Returns `unknown` — callers cast to their expected output shape.
 * store: false — one-shot generations, no need to persist on OpenAI's side.
 */
export async function completeJSON(system: string, user: string): Promise<unknown> {
  const openai = getOpenAI();
  const res = await openai.responses.create({
    model: OPENAI_MODEL,
    // System dans l'input (pas `instructions`): le JSON mode ne voit que l'input.
    input: [
      { role: "system", content: system },
      { role: "user", content: ensureJsonWord(system, user) },
    ],
    text: { format: { type: "json_object" } },
    temperature: 0.7,
    store: false,
  });

  return parseJsonStripNul(res.output_text || "{}");
}

/**
 * JSON-mode response that also sees images (vision). Used to extract a visual
 * style profile from competitor screenshots and caption the user's own ones.
 * Uses OPENAI_VISION_MODEL (defaults to the standard model, vision-capable).
 */
export async function completeJSONWithImages(
  system: string,
  text: string,
  imageUrls: string[]
): Promise<unknown> {
  const openai = getOpenAI();
  const res = await openai.responses.create({
    model: process.env.OPENAI_VISION_MODEL ?? OPENAI_MODEL,
    input: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "input_text" as const, text: ensureJsonWord(system, text) },
          ...imageUrls.slice(0, 6).map((url) => ({
            type: "input_image" as const,
            image_url: url,
            detail: "auto" as const,
          })),
        ],
      },
    ],
    text: { format: { type: "json_object" } },
    store: false,
  });

  return parseJsonStripNul(res.output_text || "{}");
}
