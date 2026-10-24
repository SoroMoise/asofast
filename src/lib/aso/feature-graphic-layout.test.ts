import { describe, expect, it } from "vitest";

import {
  breakTokens,
  DEFAULT_FEATURE_GRAPHIC_TEMPLATE,
  fitBadgeFontSize,
  fitHeadlineFontSize,
  isLightColor,
  isRtlLocale,
  lineCount,
  localeFeatureGraphicPaths,
  SAFE_MARGIN_X,
  sanitizeFeatureGraphicTemplate,
  sanitizeFeatureGraphicTexts,
  templateHasText,
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

  it("stores each language's banner next to its screenshots", () => {
    expect(localeFeatureGraphicPaths("p1", "fr-FR")).toEqual({
      image: "p1/aso/fr-FR/feature-graphic.jpg",
      texts: "p1/aso/fr-FR/feature-graphic.json",
    });
  });
});
