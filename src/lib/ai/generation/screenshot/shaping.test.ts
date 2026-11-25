import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createShaper, needsShaping } from "./shaping";

describe("needsShaping", () => {
  it("flags the scripts satori cannot compose", () => {
    for (const text of [
      "दिन", // devanagari
      "ছবি", // bengali
      "ਫੋਟੋ", // gurmukhi
      "ફોટો", // gujarati
      "ଫଟୋ", // odia
      "தமிழ்", // tamil
      "ఫోటో", // telugu
      "ಫೋಟೋ", // kannada
      "ഫോട്ടോ", // malayalam
      "ඡායාරූප", // sinhala
      "ຮູບ", // lao
      "ဓာတ်ပုံ", // myanmar
      "រូបថត", // khmer
      "Edit with AI दिन", // mixed: one word is enough
    ]) {
      expect(needsShaping(text), text).toBe(true);
    }
  });

  it("leaves the scripts satori already renders on the fast path", () => {
    for (const text of ["Photo editor", "Фоторедактор", "محرر الصور", "עורך תמונות", "แต่งรูป", "写真編集", "ფოტო"]) {
      expect(needsShaping(text), text).toBe(false);
    }
  });
});

// Polices réelles, lues dans le cache disque de fonts.ts (rempli au premier
// rendu). Absentes sur une machine neuve: ces tests sont alors sautés.
const FONT_DIR = path.join(process.cwd(), "data", "uploads", "_fonts");
const POPPINS = path.join(FONT_DIR, "Poppins-Bold.ttf");
const TAMIL = path.join(FONT_DIR, "NotoSansTamil-Regular.ttf");
const haveFonts = existsSync(POPPINS) && existsSync(TAMIL);

function font(file: string): ArrayBuffer {
  const buf = readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Contours <path> d'un mot rendu, dans l'ordre visuel (gauche → droite). */
function paths(svgDataUrl: string): string[] {
  const svg = Buffer.from(svgDataUrl.split(",")[1], "base64").toString("utf8");
  return [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
}

const style = { fontSize: 40, lineHeight: 1.15, color: "#fff" } as const;

describe.skipIf(!haveFonts)("createShaper (real fonts)", () => {
  it("reorders the pre-base vowel sign: दि starts with the i-matra, not with द", async () => {
    const shaper = await createShaper([font(POPPINS)]);
    const [first] = paths(shaper.render("दि", style).src);
    const [consonant] = paths(shaper.render("द", style).src);
    // Sans mise en forme (opentype.js), le premier glyphe posé était la consonne.
    expect(first).not.toBe(consonant);
  });

  it("forms conjuncts: क्ष is a single glyph", async () => {
    const shaper = await createShaper([font(POPPINS)]);
    expect(paths(shaper.render("क्ष", style).src)).toHaveLength(1);
  });

  it("falls back through the stack: Latin from Poppins, Tamil from Noto", async () => {
    const shaper = await createShaper([font(POPPINS), font(TAMIL)]);
    const mixed = shaper.measure("AIதமிழ்");
    expect(mixed).toBeCloseTo(shaper.measure("AI") + shaper.measure("தமிழ்"), 5);
    expect(shaper.measure("AI தமிழ்")).toBeCloseTo(mixed + shaper.spaceAdvance, 5);
  });

  it("throws rather than render a glyph no font covers", async () => {
    const shaper = await createShaper([font(POPPINS)]);
    expect(() => shaper.measure("தமிழ்")).toThrow(/U\+0BA4/);
  });

  it("keeps the layout box at the measured advance", async () => {
    const shaper = await createShaper([font(POPPINS)]);
    const img = shaper.render("हिन्दी", style);
    expect(img.width - 2 * img.marginX).toBeCloseTo(shaper.measure("हिन्दी") * style.fontSize, 2);
    expect(img.height - 2 * img.marginY).toBeCloseTo(style.fontSize * style.lineHeight, 2);
  });
});
