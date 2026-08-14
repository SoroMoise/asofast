import { describe, it, expect } from "vitest";

import { APPSTORE_LOCALES } from "@/lib/locales";
import { fetchOptionsForLocale } from "./locale-map";

describe("APPSTORE_COUNTRY coverage", () => {
  it("maps every non-English App Store target language to a dedicated storefront", () => {
    const unmapped = APPSTORE_LOCALES.map((l) => l.value).filter(
      (code) =>
        !/^en(-|$)/i.test(code) &&
        fetchOptionsForLocale("appstore", code).country === "us"
    );
    expect(unmapped).toEqual([]);
  });

  it("maps Urdu to the Pakistan storefront", () => {
    expect(fetchOptionsForLocale("appstore", "ur-PK").country).toBe("pk");
  });

  it("maps Indian-language locales to the India storefront", () => {
    expect(fetchOptionsForLocale("appstore", "ta-IN").country).toBe("in");
    expect(fetchOptionsForLocale("appstore", "bn-BD").country).toBe("bd");
  });
});
