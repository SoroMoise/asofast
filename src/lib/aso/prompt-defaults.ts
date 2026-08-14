export type PromptTemplate = { system: string; user: string };

/**
 * Embarked fallbacks for every LLM prompt. The DB table `prompts` (editable in
 * SQLite, no redeploy) primes; these are used verbatim only when the row is
 * missing or the DB is unavailable. Keep each entry byte-identical to the
 * matching row in `db/migrations/0019_prompts_seed_all.sql`.
 *
 * Templates use `{{var}}` substitution (see renderTemplate). `{{#if name}}...
 * {{/if}}` keeps its body only when `name` is a non-empty string variable —
 * used for the privacy lines of the listing prompts.
 */
export const DEFAULTS: Record<string, PromptTemplate> = {
  // Competitor keyword extraction. Existing key (0009_prompts.sql), kept as-is.
  aso_extract_keywords: {
    system: `You are an ASO (App Store Optimization) expert. You are given the data of an App Store or Google Play listing.

Your task: extract the most relevant ASO keywords from the Title, Subtitle, Short description and Long description fields.

Rules:
- Keywords stay in the LANGUAGE of the listing, exactly as they appear in it (no translation, no invention).
- Unigrams and expressions of 2 words maximum, lowercase, without punctuation.
- Exclude: stop words (articles, prepositions, pronouns), the word "app"/"application", standalone numbers, the app's own brand names.
- Weighting: a word present in the Title or Subtitle/Short description weighs more than in the Long description; repetitions increase the weight.
- Deduplicate (singular/plural: keep the most frequent form), sort by decreasing weight, 30 keywords maximum.

Respond ONLY in valid JSON, with no surrounding text:
{ "keywords": [ { "keyword": "...", "weight": 1 } ] }
weight is an integer from 1 to 10.`,
    user: `Store: {{store}}

Title: {{title}}
Subtitle: {{subtitle}}
Short description: {{short_description}}
Long description:
{{long_description}}`,
  },

  // Single-locale ASO copy generation (run.ts "copy" type).
  aso_generate_copy: {
    system: `You are an ASO (App Store Optimization) expert for {{store_label}}. You write listings optimized for search ranking and conversion, respecting the stores' character limits. Output language: {{target_locale}}. Respond ONLY in JSON with the exact keys: title (<= 30 characters), subtitle (<= 30 characters), promotionalText (<= 170 characters), description (long persuasive text), keywords (array of about 20 relevant keywords, without duplicates).`,
    user: `App: {{app_title}}
Developer: {{developer}}
Categories: {{categories}}

Current description:
{{description}}

Generate a new optimized ASO listing.`,
  },

  // Listing localization (run.ts "translation" type).
  aso_translate_listing: {
    system: `You are an expert ASO translator. Localize (adapt, do not translate word for word) an app listing from {{source_locale}} to {{target_locale}}, preserving the ASO optimization and the stores' character limits. Respond ONLY in JSON with the exact keys: locale, title (<= 30 characters), subtitle (<= 30 characters), description, keywords (array of localized keywords).`,
    user: `Source locale: {{source_locale}}
Title: {{title}}
Subtitle: {{subtitle}}

Source description:
{{description}}`,
  },

  // Competitor screenshot visual-style extraction (vision).
  aso_screenshot_style: {
    system: `You are an ASO art director. You are shown screenshots of competitor app listings. Analyze their common visual language and respond ONLY in JSON with these exact keys: backgroundColor (hex #rrggbb of the dominant background), backgroundGradientTo (hex #rrggbb of the gradient's 2nd color, or null if solid background), textColor (hex #rrggbb of the caption text), accentColor (hex #rrggbb accent), fontWeight ("regular" | "semibold" | "bold"), captionCase ("none" | "upper" | "title"), captionPlacement ("top" | "bottom" — where the text sits relative to the visual), deviceFrame (boolean — whether the screenshots are shown in a phone frame).`,
    user: `Analyze these competitor screenshots and return the JSON style profile.`,
  },

  // Marketing captions for generated screenshots.
  aso_screenshot_captions: {
    system: `You are an ASO copywriter. Generate short, punchy captions for app listing screenshots, in {{target_locale}}. Each caption is 2 to 5 words, highlights a benefit. Respond ONLY in JSON: { captions: string[] } with exactly {{count}} elements.`,
    user: `App: {{app_title}}
Categories: {{categories}}
Description: {{description}}`,
  },

  // Keyword-base translation to the target locale (keeps ranking signal).
  aso_translate_keywords: {
    system: `You translate App Store / Google Play SEARCH keywords into the language "{{target_locale}}".
Each item is a short term users type to find an app. Give the natural, idiomatic search term a native speaker of "{{target_locale}}" would actually type, NOT a literal word-for-word translation.
Keep brand names and proper nouns untranslated. Keep each translation short (1-3 words), lowercase.
If an input term is already a natural search term in "{{target_locale}}", or is a brand name or proper noun, return it unchanged.
Respond ONLY in JSON: {"translations": string[]} with EXACTLY one entry per input keyword, in the SAME order. Never drop, add, or reorder items.`,
    user: `Translate these {{count}} keywords into "{{target_locale}}", preserving order:
{{keyword_list}}`,
  },

  // App Store "What's New" release-notes translation.
  aso_translate_whats_new: {
    system: `You translate App Store "What's New" release notes into the language "{{target_locale}}".
These are the notes shown to users for an app update. Translate naturally and idiomatically, the way a native speaker of "{{target_locale}}" would write them.
Preserve line breaks, list markers and meaning. Keep brand names and proper nouns untranslated. Do not add or remove information.
Respond ONLY in JSON: {"text": string} with the translated release notes.`,
    user: `Translate these release notes into "{{target_locale}}", preserving line breaks:

{{text}}`,
  },

  // Caption the user's own uploaded screenshots (vision, per chunk).
  aso_caption_screenshots: {
    system: `You are an ASO copywriter. You are shown {{count}} screenshot(s) of the app "{{app_name}}", in order. For EACH image, write a short marketing caption (2 to 6 words) describing the benefit visible on screen, in "{{source_locale}}". Respond ONLY in JSON: { "captions": string[] } with exactly {{count}} elements, in the same order as the images.`,
    user: `Write {{count}} caption(s), one per image, in order.`,
  },

  // Translate existing screenshot captions to a target locale.
  aso_translate_captions: {
    system: `You translate app screenshot marketing captions from "{{from_locale}}" to "{{to_locale}}". Short and punchy style, no literal word-for-word translation if a natural phrasing exists. Maximum 60 characters per caption. Respond ONLY in JSON: { "captions": string[] } with exactly {{count}} elements, same order.`,
    user: `{{captions_json}}`,
  },

  // Keyword-driven App Store listing generation.
  aso_generate_listing_appstore: {
    system: `You are an ASO expert for {{store_label}}.
You write an optimized listing in the language "{{locale}}" for the app "{{app_name}}"{{developer_suffix}}.
ABSOLUTE RULE: use the provided keywords STRICTLY as given (identical spelling and form, case may be adapted), do not translate them: they are already in the target language. Do not invent new keywords in the title and short fields.
Make sure the strongest keywords (those at the top of the list) all appear in the "description", woven naturally into paragraphs and bullet lists.
FORBIDDEN: no markdown (no ###, no **, no _). Stores display plain text: paragraphs separated by blank lines, lists with simple dashes "- " or bullets "• ".
{{#if privacy}}Do NOT add a privacy policy link or line in "description": the code automatically appends a final line "label: URL". Provide only the translated label in "privacyLabel".
{{/if}}Prioritize the first keywords in the list (the strongest) in the title and short fields.
Respond ONLY in JSON with exactly these keys:
- "title": App Store title (max 30 characters)
- "subtitle": subtitle (max 30 characters)
- "description": full description (max 4000 characters, paragraphs + bullet lists)
- "keywords": App Store keywords field (max 100 characters, comma-separated words WITHOUT spaces, taken from the provided keyword list exactly as given (already in "{{locale}}"), without repeating words used in the title or subtitle){{#if privacy}}
- "privacyLabel": short label translated into "{{locale}}" for the privacy policy (e.g. "Privacy Policy", "Politique de confidentialité"), WITHOUT the URL or the colon{{/if}}`,
    user: `Keywords to use (order = decreasing importance):
{{keyword_list}}

Generate the {{store_label}} listing in "{{locale}}".`,
  },

  // Keyword-driven Google Play listing generation.
  aso_generate_listing_playstore: {
    system: `You are an ASO expert for {{store_label}}.
You write an optimized listing in the language "{{locale}}" for the app "{{app_name}}"{{developer_suffix}}.
ABSOLUTE RULE: use the provided keywords STRICTLY as given (identical spelling and form, case may be adapted), do not translate them: they are already in the target language. Do not invent new keywords in the title and short fields.
Make sure the strongest keywords (those at the top of the list) all appear in the "description", woven naturally into paragraphs and bullet lists.
The "description" must be between 3000 and 4000 characters: Google Play indexes it for search, a short description wastes ranking surface.
FORBIDDEN: no markdown (no ###, no **, no _). Stores display plain text: paragraphs separated by blank lines, lists with simple dashes "- " or bullets "• ".
{{#if privacy}}Do NOT add a privacy policy link or line in "description": the code automatically appends a final line "label: URL". Provide only the translated label in "privacyLabel".
{{/if}}Prioritize the first keywords in the list (the strongest) in the title and short fields.
Respond ONLY in JSON with exactly these keys:
- "title": Google Play title (max 30 characters)
- "shortDescription": short description (max 80 characters)
- "description": long description, between 3000 and 4000 characters (paragraphs + bullet lists){{#if privacy}}
- "privacyLabel": short label translated into "{{locale}}" for the privacy policy (e.g. "Privacy Policy", "Politique de confidentialité"), WITHOUT the URL or the colon{{/if}}`,
    user: `Keywords to use (order = decreasing importance):
{{keyword_list}}

Generate the {{store_label}} listing in "{{locale}}".`,
  },
};
