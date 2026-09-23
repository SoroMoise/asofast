import Anthropic from "@anthropic-ai/sdk";

import { parseJsonStripNul } from "./openai";

let client: Anthropic | null = null;

/** Lazy Anthropic client. SERVER ONLY. Throws if ANTHROPIC_API_KEY is unset. */
export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey, maxRetries: 5, timeout: 60_000 });
  }
  return client;
}

// Défaut claude-sonnet-5: bon rapport qualité/prix pour de la génération de texte
// structuré (copy, traductions, mots-clés). Override possible via l'env
// ANTHROPIC_MODEL / ANTHROPIC_VISION_MODEL.
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

const MAX_OUTPUT_TOKENS = 8192;

const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

function toImageMediaType(value: string): ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
    ? (value as ImageMediaType)
    : "image/png";
}

/**
 * L'API Messages de Claude n'a pas de mode JSON sans schéma (contrairement au
 * json_object d'OpenAI): on force via l'instruction système, comme le fait déjà
 * ensureJsonWord côté OpenAI pour son propre besoin (le mot "json" dans l'input).
 */
function ensureJsonInstruction(system: string): string {
  return `${system}\n\nRespond ONLY with valid JSON. No markdown code fences, no explanation before or after the JSON.`;
}

/** Un modèle enrobe parfois le JSON dans un bloc ```json — on le retire avant de parser. */
function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function textFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Une URL http(s) est passée telle quelle; un data URL (captures uploadées) est décodé en base64. */
function toImageBlock(url: string): Anthropic.ImageBlockParam {
  const dataUrlMatch = url.match(/^data:(.+?);base64,(.*)$/);
  if (dataUrlMatch) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: toImageMediaType(dataUrlMatch[1]),
        data: dataUrlMatch[2],
      },
    };
  }
  return { type: "image", source: { type: "url", url } };
}

/**
 * Équivalent de completeJSON côté Claude: même signature, même parsing (retrait
 * des NUL réutilisé depuis le provider OpenAI — même frontière, même contrainte
 * de stockage en aval).
 */
export async function completeJSON(system: string, user: string): Promise<unknown> {
  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.7,
    system: ensureJsonInstruction(system),
    messages: [{ role: "user", content: user }],
  });

  return parseJsonStripNul(extractJsonText(textFromMessage(res)) || "{}");
}

/**
 * Équivalent de completeJSONWithImages côté Claude (vision). Utilise
 * ANTHROPIC_VISION_MODEL (défaut: le modèle standard, capable en vision).
 */
export async function completeJSONWithImages(
  system: string,
  text: string,
  imageUrls: string[]
): Promise<unknown> {
  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: process.env.ANTHROPIC_VISION_MODEL ?? ANTHROPIC_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: ensureJsonInstruction(system),
    messages: [
      {
        role: "user",
        content: [{ type: "text", text }, ...imageUrls.slice(0, 6).map(toImageBlock)],
      },
    ],
  });

  return parseJsonStripNul(extractJsonText(textFromMessage(res)) || "{}");
}
