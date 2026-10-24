/**
 * Bannière (feature graphic) localisée — partie PURE (sans I/O): modèle,
 * validation et mise en page du texte. Testable sans storage ni satori.
 *
 * Principe: l'utilisateur fournit une ILLUSTRATION sans texte (1024×500, PNG
 * transparent ou plein) et un modèle (titre + 0 à 3 badges dans la langue
 * source). ASOFAST traduit le texte par langue et compose la bannière: même
 * visuel partout, texte dans la langue de la fiche. Une bannière en anglais sur
 * une fiche japonaise coûte des installations: le texte de la bannière est lu
 * avant la description.
 */

export const FEATURE_GRAPHIC_WIDTH = 1024;
export const FEATURE_GRAPHIC_HEIGHT = 500;
/**
 * Zone de sécurité horizontale. Le Play Store recadre la bannière dans plusieurs
 * emplacements (cartes de recherche/accueil ~16:9 au lieu de 2,05:1, coins
 * arrondis): jusqu'à ~70 px par côté disparaissent. Le texte reste donc à au
 * moins 96 px des bords gauche/droit, et l'illustration doit garder ses
 * éléments importants dans cette même zone.
 */
export const SAFE_MARGIN_X = 96;
export const MAX_BADGES = 3;
export const MAX_HEADLINE_LENGTH = 60;
export const MAX_BADGE_LENGTH = 32;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Emplacements storage de la bannière rendue d'une langue (et de ses textes). */
export function localeFeatureGraphicPaths(projectId: string, locale: string) {
  return {
    image: `${projectId}/aso/${locale}/feature-graphic.jpg`,
    texts: `${projectId}/aso/${locale}/feature-graphic.json`,
  };
}

export type FeatureGraphicTemplate = {
  /**
   * true: le titre affiché est le TITRE DE LA FICHE de chaque langue (déjà
   * localisé et optimisé ASO, aucune traduction). false: `headline` traduit.
   */
  useListingTitle: boolean;
  /** Titre dans la langue source (utilisé si useListingTitle = false). */
  headline: string;
  /** Badges courts (bénéfices), langue source, traduits par langue. */
  badges: string[];
  /** Côté du texte; l'illustration doit laisser cette zone libre. */
  textSide: "left" | "right";
  /** Part de la largeur réservée au texte (0.35 – 0.65). */
  textWidth: number;
  textColor: string;
  /** Fond sous l'illustration (visible là où elle est transparente). */
  backgroundColor: string;
  /** Dégradé optionnel du fond (null = fond uni). */
  backgroundGradientTo: string | null;
};

/** Textes effectivement rendus pour UNE langue (traduits ou édités). */
export type FeatureGraphicTexts = {
  headline: string;
  badges: string[];
};

export const DEFAULT_FEATURE_GRAPHIC_TEMPLATE: FeatureGraphicTemplate = {
  useListingTitle: true,
  headline: "",
  badges: [],
  textSide: "left",
  textWidth: 0.52,
  textColor: "#ffffff",
  backgroundColor: "#4f46e5",
  backgroundGradientTo: "#7c3aed",
};

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Valide/normalise un modèle venant du client ou du disque. Jamais de throw. */
export function sanitizeFeatureGraphicTemplate(raw: unknown): FeatureGraphicTemplate {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_FEATURE_GRAPHIC_TEMPLATE;
  const width = typeof r.textWidth === "number" && Number.isFinite(r.textWidth) ? r.textWidth : d.textWidth;
  return {
    useListingTitle: typeof r.useListingTitle === "boolean" ? r.useListingTitle : d.useListingTitle,
    headline: cleanText(r.headline, MAX_HEADLINE_LENGTH),
    badges: (Array.isArray(r.badges) ? r.badges : [])
      .map((b) => cleanText(b, MAX_BADGE_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_BADGES),
    textSide: r.textSide === "right" ? "right" : "left",
    textWidth: Math.min(0.65, Math.max(0.35, width)),
    textColor: typeof r.textColor === "string" && HEX.test(r.textColor) ? r.textColor : d.textColor,
    backgroundColor:
      typeof r.backgroundColor === "string" && HEX.test(r.backgroundColor)
        ? r.backgroundColor
        : d.backgroundColor,
    backgroundGradientTo:
      r.backgroundGradientTo === null || r.backgroundGradientTo === ""
        ? null
        : typeof r.backgroundGradientTo === "string" && HEX.test(r.backgroundGradientTo)
          ? r.backgroundGradientTo
          : d.backgroundGradientTo,
  };
}

/** Textes valides pour une langue (édition manuelle d'une langue). */
export function sanitizeFeatureGraphicTexts(raw: unknown): FeatureGraphicTexts {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    headline: cleanText(r.headline, MAX_HEADLINE_LENGTH),
    badges: (Array.isArray(r.badges) ? r.badges : [])
      .map((b) => cleanText(b, MAX_BADGE_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_BADGES),
  };
}

/** Le modèle a-t-il quelque chose à écrire ? */
export function templateHasText(tpl: FeatureGraphicTemplate): boolean {
  return tpl.useListingTitle || tpl.headline.length > 0 || tpl.badges.length > 0;
}

const RTL_LANGS = new Set(["ar", "he", "iw", "fa", "ur"]);

export function isRtlLocale(locale: string): boolean {
  return RTL_LANGS.has(locale.toLowerCase().split(/[-_]/)[0]);
}

// Idéogrammes, kana, hangul: un glyphe ≈ 1 em et coupable n'importe où.
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
// Écritures nettement plus larges que Poppins (même liste que render.tsx).
const WIDE = /[԰-֏஀-௿ఀ-౿ಀ-೿ഀ-ൿ඀-෿Ⴀ-ჿ]/;
// Marques combinantes: pas de largeur propre (évite de surestimer l'indien/thaï).
const COMBINING = /[̀-ͯऀ-ःऺ-ॏ॑-ॗॢॣঁ-ঃ়-ৗਁ-ਃ਼-ੑઁ-ઃ઼-્ଁ-ଃ଼-ୗஂா-்ఀ-ఄా-ౖಁ-ಃ಼-ೖഀ-ഃ഻-ൗඁ-ඃ්-ෟัิ-ฺ็-๎ັິ-ຼ່-ໍါ-ှ឴-៓ً-ְٰٟ-ׇ]/;

/** Largeur estimée d'un caractère, en em, pour Poppins bold + polices de script. */
export function charAdvance(ch: string): number {
  if (COMBINING.test(ch)) return 0;
  if (CJK.test(ch)) return 1.0;
  if (WIDE.test(ch)) return 0.95;
  if (ch === " ") return 0.28;
  if (/[A-ZÀ-ÞА-ЯΑ-Ω]/.test(ch)) return 0.7;
  return 0.6;
}

/** Découpe en unités insécables: mots séparés par des espaces, et chaque
 *  caractère CJK isolé (le moteur peut couper entre deux idéogrammes). */
export function breakTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let buf = "";
    for (const ch of word) {
      if (CJK.test(ch)) {
        if (buf) tokens.push(buf);
        tokens.push(ch);
        buf = "";
      } else {
        buf += ch;
      }
    }
    if (buf) tokens.push(buf);
  }
  return tokens;
}

function tokenWidth(token: string): number {
  let w = 0;
  for (const ch of token) w += charAdvance(ch);
  return w;
}

/** Nombre de lignes à une taille donnée (null si un token seul déborde). */
export function lineCount(text: string, fontSize: number, maxWidth: number): number | null {
  const tokens = breakTokens(text);
  if (tokens.length === 0) return 0;
  const space = charAdvance(" ") * fontSize;
  let lines = 1;
  let current = 0;
  for (const token of tokens) {
    const w = tokenWidth(token) * fontSize;
    if (w > maxWidth) return null;
    const isCjk = CJK.test(token);
    const gap = current === 0 || isCjk ? 0 : space;
    if (current + gap + w <= maxWidth) {
      current += gap + w;
    } else {
      lines++;
      current = w;
    }
  }
  return lines;
}

export const HEADLINE_LINE_HEIGHT = 1.08;

/**
 * Plus grande taille (px) telle que le titre tienne dans la boîte, sans couper
 * un mot ni dépasser `maxLines`. Plancher `min` (le moteur coupera au besoin).
 */
export function fitHeadlineFontSize(opts: {
  text: string;
  maxWidth: number;
  maxHeight: number;
  maxLines?: number;
  max?: number;
  min?: number;
}): number {
  const { text, maxWidth, maxHeight, maxLines = 3, max = 66, min = 26 } = opts;
  for (let size = max; size > min; size--) {
    const lines = lineCount(text, size, maxWidth);
    if (lines === null) continue;
    if (lines <= maxLines && lines * size * HEADLINE_LINE_HEIGHT <= maxHeight) return size;
  }
  return min;
}

/** Taille commune des badges pour qu'ils tiennent sur au plus deux rangées. */
export function fitBadgeFontSize(badges: string[], maxWidth: number): number {
  const PAD = 2 * 16; // padding horizontal d'un badge en px
  const GAP = 10;
  for (let size = 20; size >= 13; size--) {
    let rows = 1;
    let current = 0;
    let fits = true;
    for (const badge of badges) {
      const w = tokenWidth(badge) * size + PAD;
      if (w > maxWidth) {
        fits = false;
        break;
      }
      const add = current === 0 ? w : GAP + w;
      if (current + add <= maxWidth) current += add;
      else {
        rows++;
        current = w;
      }
    }
    if (fits && rows <= 2) return size;
  }
  return 13;
}

/** Couleur claire ? (pour choisir le style des badges). */
export function isLightColor(hex: string): boolean {
  const m = HEX.test(hex) ? hex : "#ffffff";
  const r = parseInt(m.slice(1, 3), 16);
  const g = parseInt(m.slice(3, 5), 16);
  const b = parseInt(m.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}
