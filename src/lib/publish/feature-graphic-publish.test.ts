import { describe, expect, it, vi } from "vitest";

import type { Listing, Project } from "@/types";

vi.mock("@/lib/db", () => ({
  getStoreCredentials: () => {
    throw new Error("not reached");
  },
  listListings: () => {
    throw new Error("not reached");
  },
  getProject: () => {
    throw new Error("not reached");
  },
}));

// Storage en mémoire: une bannière unique (current.png) + une bannière
// localisée pour fr-FR uniquement.
const FILES: Record<string, string[]> = {
  "p1/feature-graphic": ["current.png", "art.png", "template.json"],
  "p1/feature-graphic/locales": ["fr-FR.jpg", "fr-FR.json"],
  "p1/aso/fr-FR": ["01.jpg"],
  "p1/aso/de-DE": ["01.jpg"],
  "p1/icon": [],
};
vi.mock("@/lib/storage", () => ({
  listFiles: (prefix: string) =>
    (FILES[prefix] ?? []).map((name) => ({ name, path: `${prefix}/${name}` })),
  readFile: (path: string) => Buffer.from(path),
}));

import { buildUpdatesFromListings } from "./index";
import { pushesFeatureGraphic } from "./playstore";

const project = {
  id: "p1",
  user_id: "u1",
  store: "playstore",
  privacy_policy_url: "",
} as unknown as Project;

const listing = (locale: string) =>
  ({
    locale,
    title: "T",
    short_description: "S",
    description: "D",
    keywords: "",
    screenshots: [],
    screenshots_tablet: [],
  }) as unknown as Listing;

const ASSETS_ONLY = { text: false, screenshots: false, storeAssets: true, privacyAndWhatsNew: false };

describe("localized feature graphic", () => {
  it("sends each language its own banner, flagged as localized", async () => {
    const updates = await buildUpdatesFromListings(project, [listing("fr-FR")], ASSETS_ONLY);
    expect(updates).toHaveLength(1);
    expect(updates[0].featureGraphicLocalized).toBe(true);
    expect(updates[0].featureGraphic?.buffer.toString()).toBe("p1/feature-graphic/locales/fr-FR.jpg");
  });

  it("falls back to the single project banner (default language only) when none is localized", async () => {
    const [update] = await buildUpdatesFromListings(project, [listing("de-DE")], ASSETS_ONLY);
    expect(update.featureGraphicLocalized).toBeUndefined();
    expect(update.featureGraphic?.buffer.toString()).toBe("p1/feature-graphic/current.png");
  });

  it("never touches banners when store assets are not in scope", async () => {
    const updates = await buildUpdatesFromListings(project, [listing("fr-FR")], {
      ...ASSETS_ONLY,
      storeAssets: false,
    });
    expect(updates).toHaveLength(0);
  });
});

describe("pushesFeatureGraphic (Play Store)", () => {
  const banner = { buffer: Buffer.from("x"), fileName: "x.jpg" };

  it("pushes a localized banner on its own language, default or not", () => {
    const update = { locale: "fr-FR", featureGraphic: banner, featureGraphicLocalized: true };
    expect(pushesFeatureGraphic(update, false)).toBe(true);
    expect(pushesFeatureGraphic(update, true)).toBe(true);
  });

  it("pushes the single project banner on the default language only", () => {
    const update = { locale: "de-DE", featureGraphic: banner };
    expect(pushesFeatureGraphic(update, false)).toBe(false);
    expect(pushesFeatureGraphic(update, true)).toBe(true);
  });

  it("pushes nothing without a banner", () => {
    expect(pushesFeatureGraphic({ locale: "fr-FR", featureGraphicLocalized: true }, true)).toBe(false);
  });
});
