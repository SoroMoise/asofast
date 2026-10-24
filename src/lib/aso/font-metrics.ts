/**
 * Largeurs réelles des glyphes, lues dans les tables sfnt (TTF/OTF) déjà
 * chargées pour satori: `head` (unitsPerEm), `hhea` + `hmtx` (avances), `cmap`
 * (caractère → glyphe, formats 4 et 12). Pas de crénage ni de mise en forme
 * contextuelle: suffisant pour décider des coupes de ligne et des tailles, le
 * rendu reste fait par satori. Aucune dépendance: satori n'expose pas son
 * opentype.js.
 */

export type FontMetrics = {
  /** Avance du caractère en em, ou null si la police n'a pas son glyphe. */
  advance(codePoint: number): number | null;
};

type Table = { offset: number; length: number };

function tables(view: DataView): Map<string, Table> {
  let base = 0;
  // Collection (.ttc): on lit la première police.
  if (view.getUint32(0) === 0x74746366) base = view.getUint32(12);
  const count = view.getUint16(base + 4);
  const out = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(rec),
      view.getUint8(rec + 1),
      view.getUint8(rec + 2),
      view.getUint8(rec + 3)
    );
    out.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  return out;
}

/** Sous-table cmap → fonction caractère → glyphe (0 = absent). */
function cmapLookup(view: DataView, cmap: Table): (cp: number) => number {
  const count = view.getUint16(cmap.offset + 2);
  const subtables: { platform: number; encoding: number; offset: number; format: number }[] = [];
  for (let i = 0; i < count; i++) {
    const rec = cmap.offset + 4 + i * 8;
    const offset = cmap.offset + view.getUint32(rec + 4);
    subtables.push({
      platform: view.getUint16(rec),
      encoding: view.getUint16(rec + 2),
      offset,
      format: view.getUint16(offset),
    });
  }
  // Unicode complet (format 12) d'abord, sinon le BMP (format 4).
  const full = subtables.find((s) => s.format === 12 && (s.platform === 0 || s.encoding === 10));
  if (full) {
    const groups = view.getUint32(full.offset + 12);
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = full.offset + 16 + mid * 12;
        const start = view.getUint32(g);
        const end = view.getUint32(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return view.getUint32(g + 8) + (cp - start);
      }
      return 0;
    };
  }
  const bmp = subtables.find((s) => s.format === 4 && (s.platform === 0 || s.platform === 3));
  if (!bmp) return () => 0;
  const segCount = view.getUint16(bmp.offset + 6) / 2;
  const endCodes = bmp.offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segCount; i++) {
      if (view.getUint16(endCodes + i * 2) < cp) continue;
      const start = view.getUint16(startCodes + i * 2);
      if (start > cp) return 0;
      const delta = view.getInt16(idDeltas + i * 2);
      const rangePos = idRangeOffsets + i * 2;
      const range = view.getUint16(rangePos);
      if (range === 0) return (cp + delta) & 0xffff;
      const glyph = view.getUint16(rangePos + range + (cp - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

/** Lit les métriques d'une police. Throw si les tables requises manquent. */
export function parseFontMetrics(data: ArrayBuffer | Uint8Array): FontMetrics {
  const view =
    data instanceof Uint8Array
      ? new DataView(data.buffer, data.byteOffset, data.byteLength)
      : new DataView(data);
  const t = tables(view);
  const head = t.get("head");
  const hhea = t.get("hhea");
  const hmtx = t.get("hmtx");
  const cmap = t.get("cmap");
  if (!head || !hhea || !hmtx || !cmap) throw new Error("Font tables missing.");
  const unitsPerEm = view.getUint16(head.offset + 18);
  const numberOfHMetrics = view.getUint16(hhea.offset + 34);
  const glyphOf = cmapLookup(view, cmap);
  return {
    advance(cp) {
      const glyph = glyphOf(cp);
      if (glyph === 0) return null;
      // Au-delà de numberOfHMetrics, les glyphes reprennent la dernière avance.
      const i = Math.min(glyph, numberOfHMetrics - 1);
      return view.getUint16(hmtx.offset + i * 4) / unitsPerEm;
    },
  };
}

const parsed = new WeakMap<object, FontMetrics | null>();

/** parseFontMetrics mis en cache par buffer (les polices sont chargées une fois). */
export function fontMetrics(data: ArrayBuffer): FontMetrics | null {
  if (!parsed.has(data)) {
    let metrics: FontMetrics | null = null;
    try {
      metrics = parseFontMetrics(data);
    } catch {
      // Police illisible: l'appelant retombe sur l'estimation.
    }
    parsed.set(data, metrics);
  }
  return parsed.get(data) ?? null;
}

/**
 * Mesure en em d'un caractère: première police de la pile qui a le glyphe (même
 * ordre de repli que satori), sinon `fallback` (estimation).
 */
export function measurerFor(
  fonts: ArrayBuffer[],
  fallback: (ch: string) => number
): (ch: string) => number {
  const stack = fonts.map(fontMetrics).filter((m): m is FontMetrics => m !== null);
  const cache = new Map<string, number>();
  return (ch) => {
    let w = cache.get(ch);
    if (w === undefined) {
      const cp = ch.codePointAt(0) ?? 0;
      w = fallback(ch);
      for (const m of stack) {
        const a = m.advance(cp);
        if (a !== null) {
          w = a;
          break;
        }
      }
      cache.set(ch, w);
    }
    return w;
  };
}
