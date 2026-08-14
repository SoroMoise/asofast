import { renderAsync } from "@resvg/resvg-js";
import satori from "satori";

import type { ScreenshotStyle } from "@/lib/ai/types";

import { loadScriptFonts, type LoadedFonts } from "./fonts";

const WEIGHT_MAP = { regular: 400, semibold: 600, bold: 700 } as const;

/**
 * Retire les emoji d'une caption.
 *
 * Aucune de nos polices n'en contient. next/og en dessinait via `loadDynamicAsset`,
 * qui allait chercher Twemoji sur le reseau au moment du rendu; on ne rend plus
 * par next/og, et un emoji laisse tel quel deviendrait un carre vide sur une
 * capture envoyee au store. Un modele qui glisse un emoji dans une caption est
 * assez rare pour qu'on le retire silencieusement plutot que d'echouer la langue.
 *
 * `Emoji_Presentation` et pas `Extended_Pictographic`: le second embarque © ® ™,
 * que Poppins dessine tres bien et qu'on n'a aucune raison de supprimer.
 */
function stripEmoji(text: string): string {
  return text
    .replace(/\p{Emoji_Presentation}|️|‍|[\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function applyCase(text: string, kind: ScreenshotStyle["captionCase"]): string {
  if (kind === "upper") return text.toUpperCase();
  if (kind === "title") {
    return text.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return text;
}

// Advance moyen par caractere (en em) pour Poppins bold. Volontairement prudent
// (le vrai advance ~0.55, les majuscules/glyphes larges montent vers 0.64) pour
// que la simulation de retour a la ligne ne SOUS-estime jamais la largeur reelle:
// on prefere une police un peu plus petite a un texte coupe.
const AVG_CHAR_ADVANCE = 0.64;
// Interligne applique au rendu ET a la simulation de hauteur: les deux DOIVENT
// etre identiques, sinon la mesure ment et le texte deborde de la bande.
const CAPTION_LINE_HEIGHT = 1.15;
// Part de la bande headline reellement utilisable par le texte; le reste est une
// marge haut/bas pour ne jamais toucher le bord ni le screenshot en dessous.
const CAPTION_VERTICAL_FILL = 0.86;

/**
 * Plus grande police telle que la caption, une fois cassee en lignes (retour a
 * la ligne mot par mot, comme le rendu), tienne ENTIEREMENT dans la bande
 * headline de hauteur fixe: aucune ligne ne depasse la largeur disponible, et la
 * pile de lignes ne depasse pas la hauteur reservee. On part du plafond et on
 * descend d'un pixel jusqu'a ce que ca rentre, sans jamais couper. Aucun nombre
 * de lignes fige: une caption longue casse en autant de lignes que la bande peut
 * en contenir (c'est ce qui manquait aux tablettes, ou 2 lignes ne suffisaient
 * pas et le texte etait coupe).
 */
function captionFontSize(width: number, caption: string, zoneHeight: number): number {
  const avail = width * 0.88; // padding de 0.06 de chaque cote
  const usableHeight = zoneHeight * CAPTION_VERTICAL_FILL;
  const words = caption.trim().split(/\s+/).filter(Boolean);
  const minFont = width * 0.035; // plancher: en dessous, word-break prend le relais
  if (words.length === 0) return Math.round(minFont);
  const maxFont = width * 0.12; // plafond absolu (captions tres courtes)

  // Retour a la ligne glouton a une taille donnee: renvoie le nombre de lignes,
  // ou null si un mot seul est deja plus large que la largeur dispo (dans ce cas
  // il faut descendre encore). Largeur d'un mot ~ nb de chars * advance * police.
  const lineCount = (font: number): number | null => {
    const spaceWidth = AVG_CHAR_ADVANCE * font;
    let lines = 1;
    let lineWidth = 0;
    for (const word of words) {
      const wordWidth = word.length * AVG_CHAR_ADVANCE * font;
      if (wordWidth > avail) return null; // mot seul trop large a cette taille
      if (lineWidth === 0) lineWidth = wordWidth;
      else if (lineWidth + spaceWidth + wordWidth <= avail) lineWidth += spaceWidth + wordWidth;
      else {
        lines++;
        lineWidth = wordWidth;
      }
    }
    return lines;
  };

  for (let font = Math.floor(maxFont); font >= minFont; font--) {
    const lines = lineCount(font);
    if (lines === null) continue; // un mot deborde encore en largeur
    if (lines * font * CAPTION_LINE_HEIGHT <= usableHeight) return font;
  }
  return Math.round(minFont);
}

export type RenderFrameOptions = {
  width: number;
  height: number;
  style: ScreenshotStyle;
  caption: string;
  screenshotDataUrl: string;
  fonts: LoadedFonts;
  /** Arbitre le Han: zh-TW / zh-HK doivent recevoir une police traditionnelle. */
  locale?: string;
};

/**
 * Pixels bruts RGBA, prets a encoder. On ne rend PAS de PNG: l'appelant encode
 * directement en JPEG. next/og imposait un PNG intermediaire que sharp devait
 * redecoder, soit deux passes codec par frame pour rien.
 */
export type RenderedFrame = {
  pixels: Buffer;
  width: number;
  height: number;
};

/**
 * Compose one marketing screenshot: styled background + caption + the user's
 * screenshot rendered as-is (no device mockup), filling the remaining space.
 */
export async function renderFrame(opts: RenderFrameOptions): Promise<RenderedFrame> {
  const { width, height, style, caption, screenshotDataUrl, fonts, locale } = opts;

  const displayCaption = applyCase(stripEmoji(caption), style.captionCase);
  // Polices par script pour la caption: on fournit explicitement a Satori la
  // bonne police (arabe, indiennes, CJK, cyrillique, etc.) au lieu de le laisser
  // en chercher une en reseau au moment du rendu (lent, timeouts en prod). Une
  // caption latine ou devanagari renvoie [] et reste sur Poppins.
  const { fonts: scriptFonts, missing } = await loadScriptFonts(displayCaption, locale);
  // Une police de script manquante ne degrade pas: satori dessinerait des carres
  // vides et le PNG partirait quand meme sur le store. On echoue la langue, fort
  // et clair. Les autres langues du lot ne sont pas affectees (le pipeline
  // attrape par langue).
  if (missing.length > 0) {
    throw new Error(
      `Script font unavailable (${missing.join(", ")}): the caption would render as empty boxes.`
    );
  }
  const fontWeight = WEIGHT_MAP[style.fontWeight];
  // Bande réservée à la caption (assez pour 2 lignes en grande taille); tout le
  // reste va au screenshot, pleine largeur, ratio préservé (objectFit contain).
  const captionZoneH = Math.round(height * 0.2);
  const imageZoneH = height - captionZoneH;
  const fontSize = captionFontSize(width, displayCaption, captionZoneH);

  const background = style.backgroundGradientTo
    ? `linear-gradient(160deg, ${style.backgroundColor}, ${style.backgroundGradientTo})`
    : style.backgroundColor;

  const captionBlock = (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: captionZoneH,
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${Math.round(width * 0.06)}px`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          textAlign: "center",
          color: style.textColor,
          fontSize,
          fontWeight,
          lineHeight: CAPTION_LINE_HEIGHT,
          maxWidth: "100%",
          wordBreak: "break-word",
        }}
      >
        {displayCaption}
      </div>
    </div>
  );

  const screenshotBlock = (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: imageZoneH,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={screenshotDataUrl}
        alt=""
        width={width}
        height={imageZoneH}
        style={{ objectFit: "contain" }}
      />
    </div>
  );

  const children =
    style.captionPlacement === "top"
      ? [captionBlock, screenshotBlock]
      : [screenshotBlock, captionBlock];

  const element = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        background,
        // Poppins d'abord (le latin reste Poppins), puis les polices de script
        // detectees en fallback. Satori choisit, glyphe par glyphe, la premiere
        // police de la pile qui possede le caractere.
        fontFamily: ["Poppins", ...scriptFonts.map((f) => f.name)].join(", "),
      }}
    >
      {children}
    </div>
  );

  // Satori pose la mise en page et convertit chaque glyphe en <path> (embedFont,
  // actif par defaut). Le SVG est donc autoportant: resvg n'a aucune police a
  // resoudre, d'ou `loadSystemFonts: false` (un lambda n'a pas de fontconfig, et
  // le scan coute une seconde au demarrage a froid).
  const svg = await satori(element, {
    width,
    height,
    fonts: [
      { name: "Poppins", data: fonts.regular, weight: 400 as const, style: "normal" as const },
      { name: "Poppins", data: fonts.semibold, weight: 600 as const, style: "normal" as const },
      { name: "Poppins", data: fonts.bold, weight: 700 as const, style: "normal" as const },
      // Polices par script (un seul poids Regular chacune, suffisant pour les
      // scripts non latins; le bold demande par la caption degrade proprement).
      ...scriptFonts.map((f) => ({
        name: f.name,
        data: f.data,
        weight: 400 as const,
        style: "normal" as const,
      })),
    ],
  });

  // `renderAsync` et non `render`: la rasterisation part sur le threadpool libuv
  // au lieu du thread principal. C'est LE point du remplacement de next/og, qui
  // n'expose que resvg compile en WASM, synchrone. Six frames enchainees
  // bloquaient la boucle plusieurs dizaines de secondes: les sockets des uploads
  // deja en vol n'etaient plus relues et Supabase les fermait (ECONNRESET,
  // UND_ERR_SOCKET), tout comme les corps de polices en cours de telechargement.
  const rendered = await renderAsync(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  });

  // Les stores refusent une image hors format. Un arrondi de `fitTo` ne doit pas
  // partir en silence jusqu'a App Store Connect.
  if (rendered.width !== width || rendered.height !== height) {
    throw new Error(
      `Frame rendered at ${rendered.width}x${rendered.height}, expected ${width}x${height}.`
    );
  }

  return { pixels: rendered.pixels, width: rendered.width, height: rendered.height };
}
