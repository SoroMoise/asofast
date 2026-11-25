import { describe, expect, it } from "vitest";

import { scriptFontUrl } from "./fonts";

describe("scriptFontUrl", () => {
  it("serves the requested weight for scripts shaped by HarfBuzz", () => {
    expect(scriptFontUrl("tamil", "regular")).toMatch(/\/NotoSansTamil-Regular\.ttf$/);
    expect(scriptFontUrl("tamil", "semibold")).toMatch(/\/NotoSansTamil-SemiBold\.ttf$/);
    expect(scriptFontUrl("tamil", "bold")).toMatch(/\/NotoSansTamil-Bold\.ttf$/);
    expect(scriptFontUrl("myanmar", "bold")).toMatch(/\/NotoSansMyanmar-Bold\.ttf$/);
  });

  it("maps Odia SemiBold, which Noto does not publish, to Bold", () => {
    expect(scriptFontUrl("oriya", "semibold")).toMatch(/\/NotoSansOriya-Bold\.ttf$/);
  });

  it("keeps a single Regular font for scripts drawn by satori", () => {
    for (const key of ["arabic", "hebrew", "thai", "latin", "sc", "jp"] as const) {
      expect(scriptFontUrl(key, "bold")).toBe(scriptFontUrl(key, "regular"));
    }
  });
});
