import { afterEach, describe, expect, it, vi } from "vitest";

// Chaque provider est remplacé par un stub qui renvoie son propre nom: on vérifie
// que le dispatcher route vers le bon, sans appeler de réseau.
vi.mock("./openai", () => ({
  completeJSON: vi.fn(async () => "openai"),
  completeJSONWithImages: vi.fn(async () => "openai"),
}));
vi.mock("./anthropic", () => ({
  completeJSON: vi.fn(async () => "anthropic"),
  completeJSONWithImages: vi.fn(async () => "anthropic"),
}));
vi.mock("./deepseek", () => ({
  completeJSON: vi.fn(async () => "deepseek"),
  completeJSONWithImages: vi.fn(async () => "deepseek"),
}));

import { completeJSON, completeJSONWithImages } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dispatcher AI_PROVIDER", () => {
  // Casse si: un provider n'est pas câblé, ou si le repli par défaut change
  // (toute valeur absente/inconnue doit rester sur openai, comportement historique).
  it.each([
    ["openai", "openai"],
    ["anthropic", "anthropic"],
    ["deepseek", "deepseek"],
    [undefined, "openai"],
    ["", "openai"],
    ["gemini", "openai"],
  ])("AI_PROVIDER=%s route completeJSON vers %s", async (value, expected) => {
    if (value === undefined) delete process.env.AI_PROVIDER;
    else vi.stubEnv("AI_PROVIDER", value);

    expect(await completeJSON("s", "u")).toBe(expected);
  });

  it.each([
    ["openai", "openai"],
    ["anthropic", "anthropic"],
    ["deepseek", "deepseek"],
    [undefined, "openai"],
  ])("AI_PROVIDER=%s route completeJSONWithImages vers %s", async (value, expected) => {
    if (value === undefined) delete process.env.AI_PROVIDER;
    else vi.stubEnv("AI_PROVIDER", value);

    expect(await completeJSONWithImages("s", "t", ["https://example.com/a.png"])).toBe(expected);
  });
});
