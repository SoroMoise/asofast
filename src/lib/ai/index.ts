// AI generation pipeline entry point.
//
// runGeneration(id) executes a pending `generations` row: it fetches the app's
// current store metadata (scrapers), calls the AI provider (OpenAI, Anthropic or
// DeepSeek, chosen by AI_PROVIDER) for the requested type (copy | translation),
// and writes status/output via the service-role client. Screenshot generation is
// not implemented yet.
//
// Providers live under ./providers, per-type logic under ./generation/*.

export { runGeneration } from "./run";
export type { CopyOutput, TranslationOutput, GenerationInput } from "./types";
