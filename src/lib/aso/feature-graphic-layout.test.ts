import { describe, expect, it } from "vitest";

import {
  breakTokens,
  DEFAULT_FEATURE_GRAPHIC_TEMPLATE,
  featureGraphicFingerprintSource,
  fitBadgeFontSize,
  fitHeadlineFontSize,
  isLightColor,
  isRtlLocale,
  lineCount,
  localeFeatureGraphicPaths,
  SAFE_MARGIN_X,
  sanitizeFeatureGraphicTemplate,
  sanitizeFeatureGraphicTexts,
  sanitizeStoredFeatureGraphic,
  templateHasText,
  truncateAtWord,
} from "./feature-graphic-layout";

describe("sanitizeFeatureGraphicTemplate", () => {
  it("returns the defaults for garbage", () => {
    expect(sanitizeFeatureGraphicTemplate(null)).toEqual(DEFAULT_FEATURE_GRAPHIC_TEMPLATE);
    expect(sanitizeFeatureGraphicTemplate("x")).toEqual(DEFAULT_FEATURE_GRAPHIC_TEMPLATE);
  });

  it("keeps at most 3 non-empty trimmed badges and clamps the text width", () => {
    const tpl = sanitizeFeatureGraphicTemplate({
      badges: ["  Offline ", "", "Live  rates", "148 currencies", "extra"],
      textWidth: 2,
      textSide: "right",
    });
    expect(tpl.badges).toEqual(["Offline", "Live rates", "148 currencies"]);
    expect(tpl.textWidth).toBe(0.65);
    expect(tpl.textSide).toBe("right");
  });

  it("rejects invalid colors but allows turning the gradient off", () => {
    const tpl = sanitizeFeatureGraphicTemplate({
      textColor: "red",
      backgroundColor: "#123456",
      backgroundGradientTo: null,
    });
    expect(tpl.textColor).toBe(DEFAULT_FEATURE_GRAPHIC_TEMPLATE.textColor);
    expect(tpl.backgroundColor).toBe("#123456");
    expect(tpl.backgroundGradientTo).toBeNull();
  });

  it("knows when there is something to write", () => {
    expect(templateHasText({ ...DEFAULT_FEATURE_GRAPHIC_TEMPLATE, useListingTitle: false })).toBe(false);
    expect(templateHasText(DEFAULT_FEATURE_GRAPHIC_TEMPLATE)).toBe(true);
  });
});

describe("sanitizeFeatureGraphicTexts", () => {
  it("caps lengths and drops empty badges", () => {
    const t = sanitizeFeatureGraphicTexts({ headline: "x".repeat(200), badges: ["a", " ", "b"] });
    expect(t.headline.length).toBe(60);
    expect(t.badges).toEqual(["a", "b"]);
  });

  it("never cuts a translated badge in the middle of a word", () => {
    const t = sanitizeFeatureGraphicTexts({ badges: ["Funktioniert ohne Internetverbindung"] });
    expect(t.badges).toEqual(["Funktioniert ohne"]);
  });
});

describe("truncateAtWord", () => {
  it("keeps short text as is", () => {
    expect(truncateAtWord("Live rates", 32)).toBe("Live rates");
  });

  it("cuts at the last space and drops trailing punctuation", () => {
    expect(truncateAtWord("Convert currencies, even offline", 20)).toBe("Convert currencies");
  });

  it("hard-cuts text without a usable space (CJK, one long word)", () => {
    expect(truncateAtWord("為替レート計算通貨換算オフライン対応", 10)).toBe("為替レート計算通貨換");
    expect(truncateAtWord("Hi Supercalifragilisticexpialidocious", 10)).toBe("Hi Superca");
  });
});

describe("stored banner metadata", () => {
  it("reads legacy files (texts only) as automatic", () => {
    expect(sanitizeStoredFeatureGraphic({ headline: "H", badges: ["b"] })).toEqual({
      headline: "H",
      badges: ["b"],
      manual: false,
      fingerprint: "",
    });
  });

  const base = { template: DEFAULT_FEATURE_GRAPHIC_TEMPLATE, artHash: "a1", listingTitle: "Title" };

  it("changes when the layout, the illustration or the listing title changes", () => {
    const fp = featureGraphicFingerprintSource({ ...base, manual: false });
    expect(featureGraphicFingerprintSource({ ...base, manual: false, artHash: "a2" })).not.toBe(fp);
    expect(featureGraphicFingerprintSource({ ...base, manual: false, listingTitle: "New" })).not.toBe(fp);
    expect(
      featureGraphicFingerprintSource({
        ...base,
        manual: false,
        template: { ...DEFAULT_FEATURE_GRAPHIC_TEMPLATE, textSide: "right" },
      })
    ).not.toBe(fp);
  });

  it("ignores the template text for hand-edited banners, not the layout", () => {
    const fp = featureGraphicFingerprintSource({ ...base, manual: true });
    const otherText = { ...DEFAULT_FEATURE_GRAPHIC_TEMPLATE, badges: ["New badge"] };
    expect(featureGraphicFingerprintSource({ ...base, manual: true, template: otherText })).toBe(fp);
    expect(featureGraphicFingerprintSource({ ...base, manual: true, listingTitle: "New" })).toBe(fp);
    expect(featureGraphicFingerprintSource({ ...base, manual: true, artHash: "a2" })).not.toBe(fp);
  });
});

describe("layout helpers", () => {
  it("detects RTL languages from any locale form", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(isRtlLocale("fa-IR")).toBe(true);
    expect(isRtlLocale("he")).toBe(true);
    expect(isRtlLocale("fr-FR")).toBe(false);
  });

  it("splits CJK into breakable characters but keeps latin words whole", () => {
    expect(breakTokens("Convert 148 currencies")).toEqual(["Convert", "148", "currencies"]);
    expect(breakTokens("货币换算")).toEqual(["货", "币", "换", "算"]);
  });

  it("wraps a long headline onto several lines", () => {
    expect(lineCount("Currency Converter Offline", 60, 480)).toBeGreaterThan(1);
    expect(lineCount("Hi", 60, 480)).toBe(1);
    // Un mot seul plus large que la colonne: impossible à cette taille.
    expect(lineCount("Supercalifragilisticexpialidocious", 66, 300)).toBeNull();
  });

  it("shrinks the headline until it fits the box", () => {
    const big = fitHeadlineFontSize({ text: "Hi", maxWidth: 480, maxHeight: 300 });
    const long = fitHeadlineFontSize({
      text: "Конвертер валют и курсы офлайн для путешествий",
      maxWidth: 480,
      maxHeight: 240,
    });
    expect(big).toBe(66);
    expect(long).toBeLessThan(big);
    const lines = lineCount("Конвертер валют и курсы офлайн для путешествий", long, 480);
    expect(lines).not.toBeNull();
    expect((lines as number) * long * 1.08).toBeLessThanOrEqual(240);
  });

  it("fits CJK titles without spaces", () => {
    const size = fitHeadlineFontSize({ text: "為替レート計算・通貨換算 - オフライン対応", maxWidth: 480, maxHeight: 240 });
    expect(size).toBeGreaterThan(26);
  });

  it("keeps badges on two rows at most when possible", () => {
    expect(fitBadgeFontSize(["Works offline", "Live rates", "148 currencies"], 480)).toBe(20);
    expect(fitBadgeFontSize(["x".repeat(80)], 300)).toBe(13);
  });

  it("classifies text colors", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#111827")).toBe(false);
  });

  it("keeps a horizontal safe margin against Play Store cropping", () => {
    // ~70 px par côté disparaissent dans les cartes 16:9: le texte doit rester au-delà.
    expect(SAFE_MARGIN_X).toBeGreaterThanOrEqual(80);
  });

  it("stores each language's banner OUTSIDE the screenshot folders (pruned on regeneration)", () => {
    const paths = localeFeatureGraphicPaths("p1", "fr-FR");
    expect(paths).toEqual({
      image: "p1/feature-graphic/locales/fr-FR.jpg",
      texts: "p1/feature-graphic/locales/fr-FR.json",
    });
    expect(paths.image.startsWith("p1/aso/")).toBe(false);
  });
});
