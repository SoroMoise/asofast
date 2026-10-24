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
/** Marge verticale de la colonne de texte. */
export const TEXT_PAD_Y = 64;
export const MAX_BADGES = 3;
export const MAX_HEADLINE_LENGTH = 60;
export const MAX_BADGE_LENGTH = 32;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Dossier des bannières rendues. Surtout PAS `aso/<locale>/`: le nettoyage des
 * captures (removeStaleFrames, suppression des captures d'une langue) vide ce
 * dossier de tout ce qui n'est pas une frame `NN.jpg`.
 */
export function localeFeatureGraphicDir(projectId: string): string {
  return `${projectId}/feature-graphic/locales`;
}

/** Emplacements storage de la bannière rendue d'une langue (et de ses textes). */
export function localeFeatureGraphicPaths(projectId: string, locale: string) {
  const dir = localeFeatureGraphicDir(projectId);
  return {
    image: `${dir}/${locale}.jpg`,
    texts: `${dir}/${locale}.json`,
  };
}

/**
 * Origine du titre de la bannière: `custom` = `headline` du modèle, traduit;
 * `listingTitle` / `shortDescription` = champ de la FICHE de chaque langue (déjà
 * localisé et optimisé ASO, aucune traduction). Le titre de la fiche répète le
 * nom affiché sous la bannière par Google Play: `custom` par défaut.
 */
export type FeatureGraphicHeadlineSource = "custom" | "listingTitle" | "shortDescription";

export type FeatureGraphicTemplate = {
  headlineSource: FeatureGraphicHeadlineSource;
  /** Titre dans la langue source (utilisé si headlineSource = "custom"). */
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

/** Ce qui est enregistré à côté de la bannière rendue d'une langue. */
export type StoredFeatureGraphic = FeatureGraphicTexts & {
  /** Textes édités à la main: conservés tant qu'on ne revient pas à l'automatique. */
  manual: boolean;
  /** Empreinte des entrées du rendu (cf. featureGraphicFingerprintSource). */
  fingerprint: string;
};

export const DEFAULT_FEATURE_GRAPHIC_TEMPLATE: FeatureGraphicTemplate = {
  headlineSource: "custom",
  headline: "",
  badges: [],
  textSide: "left",
  textWidth: 0.52,
  textColor: "#ffffff",
  backgroundColor: "#4f46e5",
  backgroundGradientTo: "#7c3aed",
};

/**
 * Coupe à `max` caractères sans trancher un mot: au dernier espace si la coupe
 * garde au moins la moitié du texte, sinon net (CJK, mot unique très long).
 */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space >= max / 2 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? truncateAtWord(value.replace(/\s+/g, " ").trim(), max) : "";
}

/** Valide/normalise un modèle venant du client ou du disque. Jamais de throw. */
export function sanitizeFeatureGraphicTemplate(raw: unknown): FeatureGraphicTemplate {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_FEATURE_GRAPHIC_TEMPLATE;
  const width = typeof r.textWidth === "number" && Number.isFinite(r.textWidth) ? r.textWidth : d.textWidth;
  return {
    headlineSource:
      r.headlineSource === "custom" ||
      r.headlineSource === "listingTitle" ||
      r.headlineSource === "shortDescription"
        ? r.headlineSource
        : // Modèles enregistrés avant headlineSource (booléen useListingTitle).
          r.useListingTitle === true
          ? "listingTitle"
          : d.headlineSource,
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

/** Relit le fichier .json d'une langue (anciens fichiers: textes seuls). */
export function sanitizeStoredFeatureGraphic(raw: unknown): StoredFeatureGraphic {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ...sanitizeFeatureGraphicTexts(r),
    manual: r.manual === true,
    fingerprint: typeof r.fingerprint === "string" ? r.fingerprint : "",
  };
}

/**
 * Chaîne à hacher pour savoir si une bannière est périmée: mise en page,
 * illustration et, pour des textes automatiques, ce dont ils dérivent (textes
 * du modèle, titre de la fiche). Des textes manuels ne périment pas quand le
 * texte du modèle change: seule la mise en page compte pour eux.
 */
export function featureGraphicFingerprintSource(opts: {
  template: FeatureGraphicTemplate;
  artHash: string;
  manual: boolean;
  listing?: ListingHeadlineTexts | null;
}): string {
  const { template: t, artHash, manual } = opts;
  const layout = [t.textSide, t.textWidth, t.textColor, t.backgroundColor, t.backgroundGradientTo];
  const text = manual
    ? null
    : {
        headlineSource: t.headlineSource,
        headline: t.headlineSource === "custom" ? t.headline : listingHeadline(t, opts.listing),
        badges: t.badges,
      };
  return JSON.stringify({ v: 1, layout, artHash, text });
}

/** Le modèle a-t-il quelque chose à écrire ? */
export function templateHasText(tpl: FeatureGraphicTemplate): boolean {
  return tpl.headlineSource !== "custom" || tpl.headline.length > 0 || tpl.badges.length > 0;
}

/** Champs de la fiche d'une langue utilisables comme titre de bannière. */
export type ListingHeadlineTexts = { title?: string | null; shortDescription?: string | null };

/** Titre pris dans la fiche selon le modèle ("" si headlineSource = "custom"). */
export function listingHeadline(
  tpl: FeatureGraphicTemplate,
  listing?: ListingHeadlineTexts | null
): string {
  if (tpl.headlineSource === "listingTitle") return (listing?.title ?? "").trim();
  if (tpl.headlineSource === "shortDescription") return (listing?.shortDescription ?? "").trim();
  return "";
}

/**
 * Langues dont l'écriture n'est pas composée correctement par le moteur de rendu
 * (opentype.js: pas de shaper indien ni USE, cf. fonts.ts). Une bannière y serait
 * fautive: on n'en génère pas, Google Play y montre la bannière par défaut.
 */
const UNSHAPED_LANGS = new Set([
  "as", "bn", "gu", "hi", "km", "kn", "lo", "ml", "mr", "my", "ne", "or", "pa", "si", "ta", "te",
]);

export function supportsLocalizedFeatureGraphic(locale: string): boolean {
  return !UNSHAPED_LANGS.has(locale.toLowerCase().split(/[-_]/)[0]);
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

/** Largeur d'un caractère en em (réelle: cf. font-metrics, sinon charAdvance). */
export type MeasureChar = (ch: string) => number;

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

function tokenWidth(token: string, measure: MeasureChar): number {
  let w = 0;
  for (const ch of token) w += measure(ch);
  return w;
}

/** Nombre de lignes à une taille donnée (null si un token seul déborde). */
export function lineCount(
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: MeasureChar = charAdvance
): number | null {
  const tokens = breakTokens(text);
  if (tokens.length === 0) return 0;
  const space = measure(" ") * fontSize;
  let lines = 1;
  let current = 0;
  for (const token of tokens) {
    const w = tokenWidth(token, measure) * fontSize;
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
  measure?: MeasureChar;
}): number {
  const { text, maxWidth, maxHeight, maxLines = 3, max = 66, min = 26, measure } = opts;
  for (let size = max; size > min; size--) {
    const lines = lineCount(text, size, maxWidth, measure);
    if (lines === null) continue;
    if (lines <= maxLines && lines * size * HEADLINE_LINE_HEIGHT <= maxHeight) return size;
  }
  return min;
}

/** Padding horizontal (2 × 16) + bordure (2 × 1,5) d'un badge, en px. */
export const BADGE_CHROME_X = 2 * 16 + 3;
/** Marge après CHAQUE badge (dernier compris), en px: cf. le rendu. */
export const BADGE_GAP = 10;

/** Taille commune des badges pour qu'ils tiennent sur au plus deux rangées. */
export function fitBadgeFontSize(
  badges: string[],
  maxWidth: number,
  measure: MeasureChar = charAdvance
): number {
  for (let size = 20; size >= 13; size--) {
    let rows = 1;
    let current = 0;
    let fits = true;
    for (const badge of badges) {
      // Le moteur compte la marge de chaque badge dans la largeur de la rangée.
      const w = tokenWidth(badge, measure) * size + BADGE_CHROME_X + BADGE_GAP;
      if (w > maxWidth) {
        fits = false;
        break;
      }
      if (current + w <= maxWidth) current += w;
      else {
        rows++;
        current = w;
      }
    }
    if (fits && rows <= 2) return size;
  }
  return 13;
}

/** Colonne de texte (px), côté et largeur du modèle, dans la zone de sécurité. */
export function textColumnBox(tpl: FeatureGraphicTemplate): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const width = Math.round(FEATURE_GRAPHIC_WIDTH * tpl.textWidth) - SAFE_MARGIN_X;
  return {
    left: tpl.textSide === "left" ? SAFE_MARGIN_X : FEATURE_GRAPHIC_WIDTH - SAFE_MARGIN_X - width,
    top: TEXT_PAD_Y,
    width,
    height: FEATURE_GRAPHIC_HEIGHT - 2 * TEXT_PAD_Y,
  };
}

/** Luminance relative WCAG d'une couleur sRGB 0–255. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rapport de contraste WCAG (1 à 21) entre deux luminances. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Seuil WCAG AA pour du grand texte (le titre et les badges en gras). */
export const MIN_TEXT_CONTRAST = 3;
/** Part de la colonne de texte sous ce seuil au-delà de laquelle on avertit. */
export const LOW_CONTRAST_WARN_SHARE = 0.15;

export function hexToRgb(hex: string): [number, number, number] {
  const m = HEX.test(hex) ? hex : "#ffffff";
  return [parseInt(m.slice(1, 3), 16), parseInt(m.slice(3, 5), 16), parseInt(m.slice(5, 7), 16)];
}

/**
 * Part (0–1) des pixels RGB de la colonne de texte dont le contraste avec la
 * couleur du texte est sous MIN_TEXT_CONTRAST.
 */
export function lowContrastShare(pixels: Uint8Array, channels: number, textColor: string): number {
  const text = relativeLuminance(...hexToRgb(textColor));
  let low = 0;
  let total = 0;
  for (let i = 0; i + 2 < pixels.length; i += channels) {
    total++;
    if (contrastRatio(text, relativeLuminance(pixels[i], pixels[i + 1], pixels[i + 2])) < MIN_TEXT_CONTRAST) {
      low++;
    }
  }
  return total === 0 ? 0 : low / total;
}

/** Couleur claire ? (pour choisir le style des badges). */
export function isLightColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}
