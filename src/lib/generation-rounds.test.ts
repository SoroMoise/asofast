import { describe, expect, it } from "vitest";

import { filterMissingLocales } from "./generation-rounds";

describe("filterMissingLocales", () => {
  it("drops the locales that already have a listing", () => {
    expect(filterMissingLocales(["fr-FR", "de-DE", "ja"], ["de-DE"])).toEqual(["fr-FR", "ja"]);
  });

  it("keeps the order of the requested locales", () => {
    expect(filterMissingLocales(["ja", "fr-FR", "de-DE"], ["fr-FR"])).toEqual(["ja", "de-DE"]);
  });

  it("returns every locale when no listing exists yet", () => {
    expect(filterMissingLocales(["fr-FR", "ja"], [])).toEqual(["fr-FR", "ja"]);
  });

  it("returns nothing when every locale already has a listing", () => {
    expect(filterMissingLocales(["fr-FR", "ja"], ["ja", "fr-FR"])).toEqual([]);
  });

  it("ignores listings of locales that were not requested", () => {
    expect(filterMissingLocales(["fr-FR"], ["ja", "de-DE"])).toEqual(["fr-FR"]);
  });
});
