import { describe, expect, it } from "vitest";

import { lineCount } from "./feature-graphic-layout";
import { measurerFor, parseFontMetrics } from "./font-metrics";

// Police sfnt minimale: head, hhea, hmtx et UNE sous-table cmap. 1000 unités
// par em; avances des glyphes 0..2 = 500, 600, 700 (les suivants reprennent 700).
function makeFont(cmapSubtable: number[], platform: number, encoding: number): ArrayBuffer {
  const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
  const u32 = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const head = new Array(54).fill(0);
  head.splice(18, 2, ...u16(1000));
  const hhea = new Array(36).fill(0);
  hhea.splice(34, 2, ...u16(3));
  const hmtx = [...u16(500), 0, 0, ...u16(600), 0, 0, ...u16(700), 0, 0];
  const cmap = [...u16(0), ...u16(1), ...u16(platform), ...u16(encoding), ...u32(12), ...cmapSubtable];
  const list: [string, number[]][] = [
    ["cmap", cmap],
    ["head", head],
    ["hhea", hhea],
    ["hmtx", hmtx],
  ];
  let offset = 12 + list.length * 16;
  const dir: number[] = [...u32(0x00010000), ...u16(list.length), 0, 0, 0, 0, 0, 0];
  const body: number[] = [];
  for (const [tag, data] of list) {
    dir.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(offset), ...u32(data.length));
    body.push(...data);
    offset += data.length;
  }
  return new Uint8Array([...dir, ...body]).buffer;
}

function format4(segments: { start: number; end: number; delta: number }[]): number[] {
  const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
  const n = segments.length;
  return [
    ...u16(4),
    ...u16(16 + n * 8),
    ...u16(0),
    ...u16(n * 2),
    0, 0, 0, 0, 0, 0,
    ...segments.flatMap((s) => u16(s.end)),
    0, 0,
    ...segments.flatMap((s) => u16(s.start)),
    ...segments.flatMap((s) => u16(s.delta & 0xffff)),
    ...segments.flatMap(() => u16(0)),
  ];
}

function format12(groups: { start: number; end: number; glyph: number }[]): number[] {
  const u32 = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  return [
    0, 12, 0, 0,
    ...u32(16 + groups.length * 12),
    ...u32(0),
    ...u32(groups.length),
    ...groups.flatMap((g) => [...u32(g.start), ...u32(g.end), ...u32(g.glyph)]),
  ];
}

// " " → glyphe 3 (700 par héritage), "A" → 1, "B" → 2.
const BMP_FONT = makeFont(
  format4([
    { start: 32, end: 32, delta: 3 - 32 },
    { start: 65, end: 66, delta: 1 - 65 },
    { start: 0xffff, end: 0xffff, delta: 1 },
  ]),
  3,
  1
);

describe("parseFontMetrics", () => {
  it("reads advances through a format 4 cmap", () => {
    const m = parseFontMetrics(BMP_FONT);
    expect(m.advance(65)).toBe(0.6);
    expect(m.advance(66)).toBe(0.7);
    // Glyphe au-delà de numberOfHMetrics: dernière avance.
    expect(m.advance(32)).toBe(0.7);
    expect(m.advance(67)).toBeNull();
  });

  it("reads characters outside the BMP through a format 12 cmap", () => {
    const m = parseFontMetrics(
      makeFont(
        format12([
          { start: 65, end: 66, glyph: 1 },
          { start: 0x1f600, end: 0x1f600, glyph: 4 },
        ]),
        3,
        10
      )
    );
    expect(m.advance(66)).toBe(0.7);
    expect(m.advance(0x1f600)).toBe(0.7);
    expect(m.advance(0x1f601)).toBeNull();
  });

  it("rejects data that is not a font", () => {
    expect(() => parseFontMetrics(new Uint8Array(64).buffer)).toThrow();
  });
});

describe("measurerFor", () => {
  it("uses the first font that has the glyph, then the estimate", () => {
    const measure = measurerFor([BMP_FONT], () => 0.5);
    expect(measure("A")).toBe(0.6);
    expect(measure("Z")).toBe(0.5);
  });

  it("ignores unreadable fonts", () => {
    const measure = measurerFor([new Uint8Array(64).buffer, BMP_FONT], () => 0.5);
    expect(measure("B")).toBe(0.7);
  });

  it("drives the line breaking", () => {
    const measure = measurerFor([BMP_FONT], () => 0.5);
    // "AB AB" à 100 px: 130 + 70 + 130 = 330 px.
    expect(lineCount("AB AB", 100, 330, measure)).toBe(1);
    expect(lineCount("AB AB", 100, 329, measure)).toBe(2);
  });
});
