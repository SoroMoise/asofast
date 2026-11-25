/**
 * Mise en forme (shaping) HarfBuzz pour les écritures que satori ne sait pas
 * composer.
 *
 * satori pose le texte avec opentype.js, qui n'a ni shaper indien ni Universal
 * Shaping Engine: il mappe codepoint par codepoint. En devanagari, bengali,
 * tamoul, etc. une voyelle pré-base reste après sa consonne (दिन rendu दनि), les
 * conjoints ne se forment pas et les matras sortent avec leur cercle pointillé.
 *
 * On contourne le moteur: HarfBuzz (WASM) compose chaque mot, on dessine ses
 * glyphes en <path> dans un petit SVG autonome, et satori reçoit une <img> par
 * mot. satori garde la mise en page (retours à la ligne, centrage) et resvg
 * rasterise ces SVG imbriqués comme le reste: aucune police à résoudre.
 *
 * Mot par mot suffit: une espace coupe toujours un cluster, la composition ne
 * franchit jamais une frontière de mot.
 */
import type * as HarfBuzz from "harfbuzzjs";

/**
 * Écritures que satori compose mal: brahmiques (devanagari à cingalais, bloc
 * U+0900-0DFF, + extensions védique et devanagari étendu) et Asie du Sud-Est
 * (lao, birman, khmer). Le thaï reste sur satori: il n'a pas de réordonnancement
 * et opentype.js le rend correctement.
 */
const COMPLEX_SCRIPT =
  /[ऀ-෿຀-໿က-႟ក-៿᧠-᧿᳐-᳿꣠-ꣿꧠ-꧿ꩠ-ꩿ]/;

/** Vrai si le texte contient une écriture que satori ne compose pas. */
export function needsShaping(text: string): boolean {
  return COMPLEX_SCRIPT.test(text);
}

// Invisibles par défaut (ZWNJ/ZWJ, sélecteurs de variante...): HarfBuzz les
// traite sans glyphe, ils n'ont pas à être couverts par la police.
const DEFAULT_IGNORABLE = /[­͏​-‏⁠-⁤︀-️﻿]/;
// Une marque combinante ou un invisible appartient au cluster qui le précède.
const ATTACHES_TO_PREVIOUS = /[\p{M}‌‍]/u;

type HbModule = typeof HarfBuzz;
type HbFont = { font: HarfBuzz.Font; upem: number; extents: HarfBuzz.FontExtents };

// Chargé à la demande: une caption latine ne paie jamais l'instanciation WASM.
let hbModule: Promise<HbModule> | null = null;
function loadHarfBuzz(): Promise<HbModule> {
  hbModule ??= import("harfbuzzjs").catch((err: unknown) => {
    hbModule = null;
    throw err;
  });
  return hbModule;
}

// Une police HarfBuzz par buffer: fonts.ts garde chaque police en mémoire une
// fois pour toutes, la copie dans la mémoire WASM se fait donc une seule fois.
const hbFonts = new WeakMap<ArrayBuffer, HbFont>();
function hbFontFor(hb: HbModule, data: ArrayBuffer): HbFont {
  let f = hbFonts.get(data);
  if (!f) {
    const face = new hb.Face(new hb.Blob(data));
    const font = new hb.Font(face);
    f = { font, upem: face.upem, extents: font.hExtents() };
    hbFonts.set(data, f);
  }
  return f;
}

type Run = { text: string; font: HbFont };
type Glyph = { path: string; x: number; y: number; scale: number };
/** Glyphes d'un texte en unités em (origine = ligne de base, x croissant). */
type ShapedEm = { glyphs: Glyph[]; advance: number };

export type ShapeStyle = {
  fontSize: number;
  /** Interligne en multiple de fontSize, ou "normal" (métriques de la police). */
  lineHeight: number | "normal";
  color: string;
  /** Ombre portée, l'équivalent de `text-shadow: 0 <dy>px <blur>px <color>`. */
  shadow?: { dy: number; blur: number; color: string };
};

/** Un mot composé, prêt à poser dans satori comme une <img>. */
export type ShapedWord = {
  src: string;
  /** Taille de l'image (boîte de ligne + débord des glyphes). */
  width: number;
  height: number;
  /** Marges négatives qui ramènent la boîte de mise en page à la boîte de ligne. */
  marginX: number;
  marginY: number;
};

export type Shaper = {
  /** Largeur en em d'un texte (les espaces comptent pour `spaceAdvance`). */
  measure(text: string): number;
  /** Avance d'une espace, en em: l'écart à poser entre deux mots. */
  spaceAdvance: number;
  /** Compose un mot (sans espace) en image. */
  render(word: string, style: ShapeStyle): ShapedWord;
};

function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Prépare un shaper pour une pile de polices, dans l'ordre de repli de satori:
 * la police latine de la graisse voulue d'abord (Poppins couvre le devanagari),
 * puis les polices de script.
 *
 * Throw à la composition si aucun glyphe de la pile ne couvre un caractère:
 * mieux vaut échouer la langue que livrer un carré vide sur le store.
 */
export async function createShaper(fonts: ArrayBuffer[]): Promise<Shaper> {
  if (fonts.length === 0) throw new Error("createShaper: empty font stack.");
  const hb = await loadHarfBuzz();
  const stack = fonts.map((data) => hbFontFor(hb, data));
  // Ligne de base commune à tous les mots: celle de la première police, comme
  // satori pour une ligne de texte. Sinon chaque mot en écriture de repli
  // sauterait à la hauteur de ses propres métriques.
  const ref = stack[0];

  const covers = (f: HbFont, ch: string): boolean =>
    DEFAULT_IGNORABLE.test(ch) || f.font.nominalGlyph(ch.codePointAt(0) ?? 0) !== undefined;

  /** Première police de la pile qui couvre tout `chars`, sinon null. */
  const pick = (chars: string[]): HbFont | null =>
    stack.find((f) => chars.every((ch) => covers(f, ch))) ?? null;

  /**
   * Découpe un mot en segments d'une seule police. On segmente d'abord par
   * écriture (complexe / reste) en gardant marques et joints avec leur base,
   * pour qu'un cluster ne soit jamais coupé entre deux polices. Chaque segment
   * prend la première police qui le couvre en entier, et seulement à défaut on
   * descend au caractère.
   */
  const itemize = (word: string): Run[] => {
    const segments: string[][] = [];
    let complex: boolean | null = null;
    for (const ch of word) {
      const isComplex = COMPLEX_SCRIPT.test(ch);
      const current = segments[segments.length - 1];
      if (current && (isComplex === complex || ATTACHES_TO_PREVIOUS.test(ch))) {
        current.push(ch);
      } else {
        segments.push([ch]);
        complex = isComplex;
      }
    }
    const runs: Run[] = [];
    const push = (text: string, font: HbFont) => {
      const last = runs[runs.length - 1];
      if (last && last.font === font) last.text += text;
      else runs.push({ text, font });
    };
    for (const chars of segments) {
      const whole = pick(chars);
      if (whole) {
        push(chars.join(""), whole);
        continue;
      }
      for (const ch of chars) {
        const font = pick([ch]);
        if (!font) {
          const cp = (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
          throw new Error(`No font in the stack covers U+${cp}: the text would render as empty boxes.`);
        }
        push(ch, font);
      }
    }
    return runs;
  };

  const shapeRun = (run: Run, penX: number, glyphs: Glyph[]): number => {
    const buffer = new hb.Buffer();
    buffer.addText(run.text);
    buffer.guessSegmentProperties();
    hb.shape(run.font.font, buffer);
    const scale = 1 / run.font.upem;
    let x = penX;
    for (const g of buffer.getGlyphInfosAndPositions()) {
      const path = run.font.font.glyphToPath(g.codepoint);
      if (path) {
        glyphs.push({
          path,
          x: x + (g.xOffset ?? 0) * scale,
          y: (g.yOffset ?? 0) * scale,
          scale,
        });
      }
      x += (g.xAdvance ?? 0) * scale;
    }
    return x;
  };

  const cache = new Map<string, ShapedEm>();
  const shapeWord = (word: string): ShapedEm => {
    let shaped = cache.get(word);
    if (!shaped) {
      const glyphs: Glyph[] = [];
      let advance = 0;
      for (const run of itemize(word)) advance = shapeRun(run, advance, glyphs);
      shaped = { glyphs, advance };
      cache.set(word, shaped);
    }
    return shaped;
  };

  const spaceGlyph = ref.font.nominalGlyph(0x20);
  const spaceAdvance =
    spaceGlyph !== undefined ? ref.font.glyphHAdvance(spaceGlyph) / ref.upem : 0.28;

  const ascender = ref.extents.ascender / ref.upem;
  const descender = ref.extents.descender / ref.upem; // négatif
  const lineGap = ref.extents.lineGap / ref.upem;

  return {
    spaceAdvance,

    measure(text) {
      const words = text.split(/\s+/).filter(Boolean);
      const sum = words.reduce((w, word) => w + shapeWord(word).advance, 0);
      return sum + Math.max(0, words.length - 1) * spaceAdvance;
    },

    render(word, style) {
      const { fontSize, color, shadow } = style;
      const { glyphs, advance } = shapeWord(word);
      const lineHeight =
        style.lineHeight === "normal" ? ascender - descender + lineGap : style.lineHeight;
      const width = advance * fontSize;
      const lineBox = lineHeight * fontSize;
      // Ligne de base placée comme en CSS: demi-interligne + ascendante.
      const baseline = (lineBox - (ascender - descender) * fontSize) / 2 + ascender * fontSize;

      // Les glyphes débordent de la boîte de ligne (empilements indiens au-dessus
      // de l'ascendante latine, matras souscrites, approche négative) et une
      // image SVG est rognée à son cadre: on élargit le cadre puis on compense
      // par des marges négatives. Assez large aussi pour le flou de l'ombre.
      const shadowReach = shadow ? 3 * (shadow.blur / 2) + Math.abs(shadow.dy) : 0;
      const marginX = Math.ceil(Math.max(fontSize * 0.4, shadowReach));
      const marginY = Math.ceil(Math.max(fontSize * 0.6, shadowReach));
      // Pas d'arrondi: la boîte de mise en page (image moins marges) doit valoir
      // exactement la largeur mesurée, sinon la simulation de retour à la ligne
      // et satori divergent d'un pixel par mot.
      const svgW = round(width + 2 * marginX);
      const svgH = round(lineBox + 2 * marginY);

      const paths = glyphs
        .map((g) => {
          const tx = round(marginX + g.x * fontSize);
          const ty = round(marginY + baseline - g.y * fontSize);
          const s = round(g.scale * fontSize);
          // Le contour HarfBuzz est en unités de police, y vers le haut.
          return `<path transform="translate(${tx} ${ty}) scale(${s} ${-s})" d="${g.path}"/>`;
        })
        .join("");
      const filter = shadow
        ? `<filter id="s" filterUnits="userSpaceOnUse" x="0" y="0" width="${svgW}" height="${svgH}">` +
          `<feDropShadow dx="0" dy="${shadow.dy}" stdDeviation="${shadow.blur / 2}" flood-color="${escapeAttr(shadow.color)}"/>` +
          `</filter>`
        : "";
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">` +
        filter +
        `<g fill="${escapeAttr(color)}"${shadow ? ' filter="url(#s)"' : ""}>${paths}</g></svg>`;

      return {
        src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        width: svgW,
        height: svgH,
        marginX,
        marginY,
      };
    },
  };
}
