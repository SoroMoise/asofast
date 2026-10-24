/**
 * Bannière (feature graphic) localisée — partie serveur: stockage, traduction
 * et rendu satori. La mise en page pure est dans feature-graphic-layout.ts.
 *
 * Stockage (data/uploads):
 *   <projectId>/feature-graphic/art.<png|jpg>        illustration SANS texte
 *   <projectId>/feature-graphic/template.json        modèle (langue source)
 *   <projectId>/aso/<locale>/feature-graphic.jpg     bannière rendue par langue
 *   <projectId>/aso/<locale>/feature-graphic.json    textes rendus pour la langue
 * L'ancien `feature-graphic/current.*` (bannière unique) reste le repli de la
 * langue par défaut quand aucune bannière localisée n'existe.
 */
import { renderAsync } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";

import { loadFonts, loadScriptFonts } from "@/lib/ai/generation/screenshot/fonts";
import { listFiles, readFile, saveFile } from "@/lib/storage";

import {
  FEATURE_GRAPHIC_HEIGHT as H,
  FEATURE_GRAPHIC_WIDTH as W,
  fitBadgeFontSize,
  fitHeadlineFontSize,
  HEADLINE_LINE_HEIGHT,
  isLightColor,
  isRtlLocale,
  localeFeatureGraphicPaths,
  SAFE_MARGIN_X,
  sanitizeFeatureGraphicTemplate,
  sanitizeFeatureGraphicTexts,
  type FeatureGraphicTemplate,
  type FeatureGraphicTexts,
} from "./feature-graphic-layout";
import { translateCaptions } from "./screenshots";

export * from "./feature-graphic-layout";

const JPEG_QUALITY = 90;
// Texte toujours dans la zone de sécurité (recadrage horizontal du Play Store).
const PAD_X = SAFE_MARGIN_X;
const PAD_Y = 64;

function templatePath(projectId: string): string {
  return `${projectId}/feature-graphic/template.json`;
}

/** Modèle enregistré, ou null s'il n'a jamais été configuré. */
export function readFeatureGraphicTemplate(projectId: string): FeatureGraphicTemplate | null {
  try {
    return sanitizeFeatureGraphicTemplate(JSON.parse(readFile(templatePath(projectId)).toString("utf8")));
  } catch {
    return null;
  }
}

export function saveFeatureGraphicTemplate(projectId: string, raw: unknown): FeatureGraphicTemplate {
  const tpl = sanitizeFeatureGraphicTemplate(raw);
  saveFile(templatePath(projectId), Buffer.from(JSON.stringify(tpl, null, 2)));
  return tpl;
}

/** Chemin storage de l'illustration, ou null. */
export function findFeatureGraphicArt(projectId: string): string | null {
  const file = listFiles(`${projectId}/feature-graphic`).find((f) => f.name.startsWith("art."));
  return file?.path ?? null;
}

/** La génération localisée est-elle configurée pour ce projet ? */
export function isFeatureGraphicConfigured(projectId: string): boolean {
  return readFeatureGraphicTemplate(projectId) !== null && findFeatureGraphicArt(projectId) !== null;
}

export function readLocaleFeatureGraphicTexts(
  projectId: string,
  locale: string
): FeatureGraphicTexts | null {
  try {
    const raw = readFile(localeFeatureGraphicPaths(projectId, locale).texts).toString("utf8");
    return sanitizeFeatureGraphicTexts(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function hasLocaleFeatureGraphic(projectId: string, locale: string): boolean {
  return listFiles(`${projectId}/aso/${locale}`).some((f) => f.name === "feature-graphic.jpg");
}

/**
 * Textes de la bannière pour une langue: titre = titre de la fiche (déjà
 * localisé) ou titre du modèle traduit; badges traduits. La langue source n'est
 * jamais traduite. Un échec de traduction retombe sur la langue source (même
 * contrat que translateCaptions): une langue n'est jamais bloquée pour ça.
 */
export async function resolveFeatureGraphicTexts(opts: {
  template: FeatureGraphicTemplate;
  sourceLocale: string;
  locale: string;
  listingTitle?: string | null;
}): Promise<FeatureGraphicTexts> {
  const { template, sourceLocale, locale } = opts;
  const items = [
    ...(template.useListingTitle || !template.headline ? [] : [template.headline]),
    ...template.badges,
  ];
  const translated =
    items.length === 0 ? [] : await translateCaptions(items, sourceLocale, locale);
  const headline = template.useListingTitle
    ? (opts.listingTitle ?? "").trim()
    : template.headline
      ? (translated[0] ?? template.headline)
      : "";
  const badges = translated.slice(template.useListingTitle || !template.headline ? 0 : 1);
  return sanitizeFeatureGraphicTexts({ headline, badges });
}

function contentTypeFor(path: string): string {
  return /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";
}

/** Compose une bannière 1024×500 (JPEG, sans alpha). */
export async function renderFeatureGraphic(opts: {
  template: FeatureGraphicTemplate;
  texts: FeatureGraphicTexts;
  artDataUrl: string;
  locale: string;
}): Promise<Buffer> {
  const { template, texts, artDataUrl, locale } = opts;
  const allText = [texts.headline, ...texts.badges].join(" ");
  const [fonts, script] = await Promise.all([loadFonts(), loadScriptFonts(allText, locale)]);
  if (script.missing.length > 0) {
    throw new Error(
      `Script font unavailable (${script.missing.join(", ")}): the banner text would render as empty boxes.`
    );
  }

  const rtl = isRtlLocale(locale);
  const colWidth = Math.round(W * template.textWidth) - PAD_X;
  const badgeSize = texts.badges.length > 0 ? fitBadgeFontSize(texts.badges, colWidth) : 0;
  // Réserve verticale des badges: au plus deux rangées (fitBadgeFontSize).
  const badgeReserve = texts.badges.length > 0 ? Math.round((badgeSize + 18) * 2 + 10 + 24) : 0;
  const headlineSize = texts.headline
    ? fitHeadlineFontSize({
        text: texts.headline,
        maxWidth: colWidth,
        maxHeight: H - 2 * PAD_Y - badgeReserve,
      })
    : 0;

  const light = isLightColor(template.textColor);
  const background = template.backgroundGradientTo
    ? `linear-gradient(135deg, ${template.backgroundColor}, ${template.backgroundGradientTo})`
    : template.backgroundColor;
  const align = rtl ? "flex-end" : "flex-start";

  const element = (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: W,
        height: H,
        background,
        fontFamily: ["Poppins", ...script.fonts.map((f) => f.name)].join(", "),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={artDataUrl}
        alt=""
        width={W}
        height={H}
        style={{ position: "absolute", left: 0, top: 0, width: W, height: H, objectFit: "cover" }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          ...(template.textSide === "left" ? { left: PAD_X } : { right: PAD_X }),
          width: colWidth,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: align,
        }}
      >
        {texts.headline ? (
          <div
            style={{
              display: "flex",
              color: template.textColor,
              fontSize: headlineSize,
              fontWeight: 700,
              lineHeight: HEADLINE_LINE_HEIGHT,
              letterSpacing: -0.5,
              textAlign: rtl ? "right" : "left",
              textShadow: light ? "0 2px 14px rgba(0,0,0,0.25)" : "none",
            }}
          >
            {texts.headline}
          </div>
        ) : null}
        {texts.badges.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: align,
              marginTop: texts.headline ? 24 : 0,
            }}
          >
            {texts.badges.map((badge, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  marginRight: rtl ? 0 : 10,
                  marginLeft: rtl ? 10 : 0,
                  marginBottom: 10,
                  padding: "8px 16px",
                  borderRadius: 999,
                  fontSize: badgeSize,
                  fontWeight: 600,
                  color: template.textColor,
                  background: light ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.06)",
                  border: light ? "1.5px solid rgba(255,255,255,0.38)" : "1.5px solid rgba(0,0,0,0.18)",
                }}
              >
                {badge}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );

  const svg = await satori(element, {
    width: W,
    height: H,
    fonts: [
      { name: "Poppins", data: fonts.regular, weight: 400 as const, style: "normal" as const },
      { name: "Poppins", data: fonts.semibold, weight: 600 as const, style: "normal" as const },
      { name: "Poppins", data: fonts.bold, weight: 700 as const, style: "normal" as const },
      ...script.fonts.map((f) => ({
        name: f.name,
        data: f.data,
        weight: 400 as const,
        style: "normal" as const,
      })),
    ],
  });
  const rendered = await renderAsync(svg, {
    fitTo: { mode: "width", value: W },
    font: { loadSystemFonts: false },
  });
  if (rendered.width !== W || rendered.height !== H) {
    throw new Error(`Banner rendered at ${rendered.width}x${rendered.height}, expected ${W}x${H}.`);
  }
  // Google Play refuse l'alpha sur le feature graphic: on aplatit sur le fond.
  return sharp(rendered.pixels, { raw: { width: W, height: H, channels: 4 } })
    .flatten({ background: template.backgroundColor })
    .jpeg({ quality: JPEG_QUALITY, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

export type LocaleFeatureGraphic = {
  locale: string;
  url: string;
  texts: FeatureGraphicTexts;
};

/**
 * Rend et enregistre la bannière d'une langue. `texts` fourni = textes édités à
 * la main (aucune traduction); sinon ils sont résolus depuis le modèle.
 */
export async function generateLocaleFeatureGraphic(opts: {
  projectId: string;
  sourceLocale: string;
  locale: string;
  listingTitle?: string | null;
  texts?: FeatureGraphicTexts;
}): Promise<LocaleFeatureGraphic> {
  const template = readFeatureGraphicTemplate(opts.projectId);
  if (!template) throw new Error("Banner template not configured.");
  const artPath = findFeatureGraphicArt(opts.projectId);
  if (!artPath) throw new Error("Banner illustration missing: upload it first.");

  const texts = opts.texts
    ? sanitizeFeatureGraphicTexts(opts.texts)
    : await resolveFeatureGraphicTexts({
        template,
        sourceLocale: opts.sourceLocale,
        locale: opts.locale,
        listingTitle: opts.listingTitle,
      });

  const artDataUrl = `data:${contentTypeFor(artPath)};base64,${readFile(artPath).toString("base64")}`;
  const jpeg = await renderFeatureGraphic({ template, texts, artDataUrl, locale: opts.locale });

  const paths = localeFeatureGraphicPaths(opts.projectId, opts.locale);
  saveFile(paths.image, jpeg);
  saveFile(paths.texts, Buffer.from(JSON.stringify(texts, null, 2)));
  return { locale: opts.locale, url: `/api/files/${paths.image}?v=${Date.now()}`, texts };
}
