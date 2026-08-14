import { DEFAULTS, type PromptTemplate } from "./prompt-defaults";

export type { PromptTemplate };

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: PromptTemplate; at: number }>();

/** Prompt depuis la DB locale (cache 60 s), fallback sur la version embarquee. */
export async function getPrompt(key: string): Promise<PromptTemplate> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const { getPrompt: dbGetPrompt } = await import("@/lib/db");
    const row = dbGetPrompt(key);
    if (row && typeof row.system === "string" && typeof row.user === "string") {
      const value = { system: row.system, user: row.user };
      cache.set(key, { value, at: Date.now() });
      return value;
    }
  } catch {
    // DB indisponible: fallback silencieux sur le prompt embarque.
  }

  const fallback = DEFAULTS[key];
  if (!fallback) throw new Error(`Prompt inconnu: ${key}`);
  return fallback;
}

export function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  const withConditionals = template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, name: string, body: string) => {
      const value = variables[name];
      return typeof value === "string" && value.length > 0 ? body : "";
    }
  );
  return withConditionals.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : ""
  );
}
