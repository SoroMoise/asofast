import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { measureTextContrast } from "./feature-graphic-contrast";
import {
  contrastRatio,
  DEFAULT_FEATURE_GRAPHIC_TEMPLATE,
  lowContrastShare,
  relativeLuminance,
  textColumnBox,
} from "./feature-graphic-layout";

const transparentArt = () =>
  sharp({ create: { width: 1024, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();

// Illustration claire sur la moitié gauche (là où va le texte par défaut).
const lightLeftArt = () =>
  sharp({ create: { width: 1024, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: Buffer.from('<svg width="1024" height="500"><rect width="560" height="500" fill="#f5f5f5"/></svg>'),
      },
    ])
    .png()
    .toBuffer();

describe("contrast helpers", () => {
  it("matches the WCAG reference values", () => {
    const white = relativeLuminance(255, 255, 255);
    const black = relativeLuminance(0, 0, 0);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBe(1);
  });

  it("counts the share of pixels below the minimum contrast", () => {
    const pixels = new Uint8Array([255, 255, 255, 0, 0, 0, 250, 250, 250, 20, 20, 20]);
    expect(lowContrastShare(pixels, 3, "#ffffff")).toBe(0.5);
    expect(lowContrastShare(pixels, 3, "#000000")).toBe(0.5);
  });

  it("puts the text column inside the safe zone, on the template side", () => {
    const left = textColumnBox({ ...DEFAULT_FEATURE_GRAPHIC_TEMPLATE, textWidth: 0.5 });
    expect(left).toEqual({ left: 96, top: 64, width: 416, height: 372 });
    const right = textColumnBox({ ...DEFAULT_FEATURE_GRAPHIC_TEMPLATE, textWidth: 0.5, textSide: "right" });
    expect(right.left + right.width).toBe(1024 - 96);
  });
});

describe("measureTextContrast", () => {
  it("passes white text on the default dark gradient", async () => {
    const out = await measureTextContrast(DEFAULT_FEATURE_GRAPHIC_TEMPLATE, await transparentArt());
    expect(out).toEqual({ lowShare: 0, warn: false });
  });

  it("warns when the illustration is light behind white text", async () => {
    const out = await measureTextContrast(DEFAULT_FEATURE_GRAPHIC_TEMPLATE, await lightLeftArt());
    expect(out.warn).toBe(true);
    expect(out.lowShare).toBeGreaterThan(0.9);
  });

  it("does not warn when the text moves to the free side", async () => {
    const out = await measureTextContrast(
      { ...DEFAULT_FEATURE_GRAPHIC_TEMPLATE, textSide: "right", textWidth: 0.4 },
      await lightLeftArt()
    );
    expect(out.warn).toBe(false);
  });
});
