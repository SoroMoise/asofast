import { describe, expect, it } from "vitest";

import { FULL_SCOPE, isEmptyScope, normalizePublishScope } from "./scope";

describe("normalizePublishScope", () => {
  it("publishes everything when the field is absent or not an object", () => {
    // Un appelant qui ignore l'option (ou un body malformé) garde le
    // comportement d'avant: tout part.
    for (const raw of [undefined, null, "all", 1, []]) {
      expect(normalizePublishScope(raw)).toEqual(FULL_SCOPE);
    }
  });

  it("publishes everything for an empty object", () => {
    expect(normalizePublishScope({})).toEqual(FULL_SCOPE);
  });

  it("turns off only what is explicitly false", () => {
    expect(normalizePublishScope({ screenshots: false })).toEqual({
      text: true,
      screenshots: false,
      storeAssets: true,
      privacyAndWhatsNew: true,
    });
  });

  it("never amputates a publish on a non-boolean falsy value", () => {
    // Régression volontaire: un `0`, un `""` ou un `"false"` venant d'un client
    // approximatif ne doit PAS silencieusement retirer les screenshots d'un run
    // de 50 langues. Seul le booléen `false` compte.
    for (const value of [0, "", "false", null, undefined, NaN]) {
      expect(normalizePublishScope({ screenshots: value }).screenshots).toBe(true);
    }
  });

  it("reads the four blocks independently", () => {
    expect(
      normalizePublishScope({
        text: false,
        screenshots: false,
        storeAssets: false,
        privacyAndWhatsNew: false,
      })
    ).toEqual({
      text: false,
      screenshots: false,
      storeAssets: false,
      privacyAndWhatsNew: false,
    });
  });
});

describe("isEmptyScope", () => {
  const scope = (
    text: boolean,
    screenshots: boolean,
    storeAssets: boolean,
    privacyAndWhatsNew = false
  ) => ({
    text,
    screenshots,
    storeAssets,
    privacyAndWhatsNew,
  });

  it("is false as soon as text or screenshots is on, whatever the store", () => {
    for (const store of ["appstore", "playstore"] as const) {
      expect(isEmptyScope(scope(true, false, false), store)).toBe(false);
      expect(isEmptyScope(scope(false, true, false), store)).toBe(false);
    }
  });

  it("is true when nothing at all is selected", () => {
    expect(isEmptyScope(scope(false, false, false), "appstore")).toBe(true);
    expect(isEmptyScope(scope(false, false, false), "playstore")).toBe(true);
  });

  it("counts storeAssets on Play Store only", () => {
    expect(isEmptyScope(scope(false, false, true), "playstore")).toBe(false);
  });

  it("ignores storeAssets on App Store (the trap)", () => {
    // L'icône App Store vient du binaire, pas de la fiche: le chemin App Store
    // ne lit JAMAIS ce bloc. Un test aveugle au store laisserait passer ce
    // scope et publierait strictement rien, 50 langues durant.
    expect(isEmptyScope(scope(false, false, true), "appstore")).toBe(true);
  });

  it("counts privacy + What's New on App Store only", () => {
    // Case cochée seule = mise à jour de version: le bouton doit rester actif.
    expect(isEmptyScope(scope(false, false, false, true), "appstore")).toBe(false);
    // Symétrie de storeAssets: le bloc n'existe pas côté Play, il ne sauve donc
    // pas un scope par ailleurs vide.
    expect(isEmptyScope(scope(false, false, false, true), "playstore")).toBe(true);
  });
});
