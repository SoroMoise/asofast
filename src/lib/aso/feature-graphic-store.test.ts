import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@/types";

// Storage en mémoire: chemin → contenu. listFiles ne liste que les fichiers
// directement sous le préfixe (comme le storage local).
const store = new Map<string, Buffer>();
vi.mock("@/lib/storage", () => ({
  listFiles: (prefix: string) =>
    [...store.keys()]
      .filter((p) => p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes("/"))
      .sort()
      .map((path) => ({ name: path.slice(prefix.length + 1), path })),
  readFile: (path: string) => {
    const buf = store.get(path);
    if (!buf) throw new Error(`ENOENT ${path}`);
    return buf;
  },
  saveFile: (path: string, buf: Buffer) => {
    store.set(path, buf);
    return path;
  },
  deleteFile: (path: string) => {
    store.delete(path);
  },
}));

const completeJSON = vi.fn();
vi.mock("@/lib/ai/providers", () => ({
  completeJSON: (...args: unknown[]) => completeJSON(...args),
  completeJSONWithImages: vi.fn(),
}));
// Pas de ligne en DB: getPrompt retombe sur les prompts embarqués.
vi.mock("@/lib/db", () => ({ getPrompt: () => undefined }));
// Rendu satori (JSX) hors sujet ici: seul pruneLocaleFrames est utilisé.
vi.mock("@/lib/ai/generation/screenshot/render", () => ({ renderFrame: vi.fn() }));

import {
  DEFAULT_FEATURE_GRAPHIC_TEMPLATE,
  localeFeatureGraphicPaths,
  type StoredFeatureGraphic,
} from "./feature-graphic-layout";
import {
  deleteLocaleFeatureGraphic,
  featureGraphicFingerprint,
  loadFeatureGraphicContext,
  localeFeatureGraphicStatus,
  resolveLocaleFeatureGraphicTexts,
  saveFeatureGraphicTemplate,
  translateFeatureGraphicTexts,
} from "./feature-graphic-store";
import { pruneLocaleFrames } from "./screenshots";

const P = "p1";

function storeBanner(locale: string, stored: StoredFeatureGraphic) {
  const paths = localeFeatureGraphicPaths(P, locale);
  store.set(paths.image, Buffer.from("jpeg"));
  store.set(paths.texts, Buffer.from(JSON.stringify(stored)));
}

beforeEach(() => {
  store.clear();
  completeJSON.mockReset();
  store.set(`${P}/feature-graphic/art.png`, Buffer.from("art-v1"));
  saveFeatureGraphicTemplate(P, {
    ...DEFAULT_FEATURE_GRAPHIC_TEMPLATE,
    headlineSource: "custom",
    headline: "Convert currencies offline",
    badges: ["Works offline", "Live rates"],
  });
});

describe("screenshot cleanup", () => {
  it("never deletes a localized banner (regression)", async () => {
    storeBanner("fr-FR", { headline: "H", badges: [], manual: true, fingerprint: "" });
    store.set(`${P}/aso/fr-FR/01.jpg`, Buffer.from("1"));
    store.set(`${P}/aso/fr-FR/02.jpg`, Buffer.from("2"));

    await pruneLocaleFrames({ id: P } as Project, "fr-FR", { phone: 1, tablet: 0 });

    expect(store.has(`${P}/aso/fr-FR/02.jpg`)).toBe(false);
    expect(store.has(localeFeatureGraphicPaths(P, "fr-FR").image)).toBe(true);
    expect(store.has(localeFeatureGraphicPaths(P, "fr-FR").texts)).toBe(true);
  });

  it("deletes a language's banner with its listing", () => {
    storeBanner("fr-FR", { headline: "H", badges: [], manual: false, fingerprint: "" });
    deleteLocaleFeatureGraphic(P, "fr-FR");
    expect(store.has(localeFeatureGraphicPaths(P, "fr-FR").image)).toBe(false);
    expect(store.has(localeFeatureGraphicPaths(P, "fr-FR").texts)).toBe(false);
  });
});

describe("translateFeatureGraphicTexts", () => {
  const texts = { headline: "Convert currencies offline", badges: ["Works offline", "Live rates"] };

  it("does not call the model for the source language", async () => {
    expect(await translateFeatureGraphicTexts(texts, "en-US", "en-US")).toBe(texts);
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("passes the length limits to the dedicated prompt", async () => {
    completeJSON.mockResolvedValue({ headline: "Convertir hors ligne", badges: ["Hors ligne", "Taux en direct"] });
    const out = await translateFeatureGraphicTexts(texts, "en-US", "fr-FR");
    expect(out).toEqual({ headline: "Convertir hors ligne", badges: ["Hors ligne", "Taux en direct"] });
    const [system, user, label] = completeJSON.mock.calls[0];
    expect(system).toContain("at most 60 characters");
    expect(system).toContain("at most 32 characters");
    expect(system).toContain("exactly 2 badges");
    expect(JSON.parse(user as string)).toEqual(texts);
    expect(label).toBe("feature_graphic_translate");
  });

  it("falls back to the source text per missing item, and entirely on failure", async () => {
    completeJSON.mockResolvedValueOnce({ headline: "", badges: ["Hors ligne"] });
    expect(await translateFeatureGraphicTexts(texts, "en-US", "fr-FR")).toEqual({
      headline: "Convert currencies offline",
      badges: ["Hors ligne", "Live rates"],
    });
    completeJSON.mockRejectedValueOnce(new Error("rate limited"));
    expect(await translateFeatureGraphicTexts(texts, "en-US", "fr-FR")).toEqual(texts);
  });
});

describe("resolveLocaleFeatureGraphicTexts", () => {
  it("keeps hand-edited text when regenerating, unless reset", async () => {
    storeBanner("fr-FR", { headline: "Mon titre", badges: ["Mon badge"], manual: true, fingerprint: "" });
    completeJSON.mockResolvedValue({ headline: "Auto", badges: ["A", "B"] });
    const ctx = loadFeatureGraphicContext(P);

    const kept = await resolveLocaleFeatureGraphicTexts(ctx, { sourceLocale: "en-US", locale: "fr-FR" });
    expect(kept).toEqual({ texts: { headline: "Mon titre", badges: ["Mon badge"] }, manual: true });
    expect(completeJSON).not.toHaveBeenCalled();

    const reset = await resolveLocaleFeatureGraphicTexts(ctx, {
      sourceLocale: "en-US",
      locale: "fr-FR",
      resetManual: true,
    });
    expect(reset).toEqual({ texts: { headline: "Auto", badges: ["A", "B"] }, manual: false });
  });

  it("uses the listing field as is (no translation) when the template says so", async () => {
    const listing = { title: "  My App: Currency  ", shortDescription: "Convertisseur hors ligne" };
    for (const [headlineSource, expected] of [
      ["listingTitle", "My App: Currency"],
      ["shortDescription", "Convertisseur hors ligne"],
    ] as const) {
      const ctx = loadFeatureGraphicContext(P, { ...DEFAULT_FEATURE_GRAPHIC_TEMPLATE, headlineSource });
      const out = await resolveLocaleFeatureGraphicTexts(ctx, {
        sourceLocale: "en-US",
        locale: "fr-FR",
        listing,
      });
      expect(out.texts.headline).toBe(expected);
    }
    expect(completeJSON).not.toHaveBeenCalled();
  });
});

describe("localeFeatureGraphicStatus", () => {
  it("flags a banner as outdated when the illustration or template text changes", () => {
    const ctx = loadFeatureGraphicContext(P);
    storeBanner("fr-FR", {
      headline: "H",
      badges: [],
      manual: false,
      fingerprint: featureGraphicFingerprint(ctx, false, null),
    });
    expect(localeFeatureGraphicStatus(ctx, "fr-FR", null)).toMatchObject({ exists: true, stale: false });
    expect(localeFeatureGraphicStatus(ctx, "de-DE", null)).toMatchObject({ exists: false, stale: false });

    store.set(`${P}/feature-graphic/art.png`, Buffer.from("art-v2"));
    expect(localeFeatureGraphicStatus(loadFeatureGraphicContext(P), "fr-FR", null).stale).toBe(true);
  });

  it("keeps hand-edited banners fresh when only the template text changes", () => {
    const ctx = loadFeatureGraphicContext(P);
    storeBanner("fr-FR", {
      headline: "H",
      badges: [],
      manual: true,
      fingerprint: featureGraphicFingerprint(ctx, true, null),
    });
    const newText = loadFeatureGraphicContext(P, { ...ctx.template, badges: ["Other"] });
    expect(localeFeatureGraphicStatus(newText, "fr-FR", null).stale).toBe(false);
    const newLayout = loadFeatureGraphicContext(P, { ...ctx.template, textSide: "right" });
    expect(localeFeatureGraphicStatus(newLayout, "fr-FR", null).stale).toBe(true);
  });

  it("treats banners rendered before fingerprints existed as outdated", () => {
    storeBanner("fr-FR", { headline: "H", badges: [], manual: false, fingerprint: "" });
    expect(localeFeatureGraphicStatus(loadFeatureGraphicContext(P), "fr-FR", null).stale).toBe(true);
  });
});
