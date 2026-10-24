/**
 * Bannière (feature graphic) localisée — rendu satori et enregistrement. Le
 * stockage, la traduction et l'empreinte sont dans feature-graphic-store.ts, la
 * mise en page pure dans feature-graphic-layout.ts.
 *
 * Stockage (data/uploads):
 *   <projectId>/feature-graphic/art.<png|jpg>        illustration SANS texte
 *   <projectId>/feature-graphic/template.json        modèle (langue source)
 *   <projectId>/feature-graphic/locales/<locale>.jpg   bannière rendue par langue
 *   <projectId>/feature-graphic/locales/<locale>.json  textes rendus + empreinte
 * L'ancien `feature-graphic/current.*` (bannière unique) reste le repli de la
 * langue par défaut quand aucune bannière localisée n'existe.
 */
import { renderAsync } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";

import { loadFonts, loadScriptFonts } from "@/lib/ai/generation/screenshot/fonts";
import { saveFile } from "@/lib/storage";

import {
  BADGE_GAP,
  FEATURE_GRAPHIC_HEIGHT as H,
  FEATURE_GRAPHIC_WIDTH as W,
  fitBadgeFontSize,
  fitHeadlineFontSize,
  HEADLINE_LINE_HEIGHT,
  isLightColor,
  isRtlLocale,
  localeFeatureGraphicPaths,
  SAFE_MARGIN_X,
  type FeatureGraphicTemplate,
  type FeatureGraphicTexts,
  type StoredFeatureGraphic,
} from "./feature-graphic-layout";
import {
  featureGraphicFingerprint,
  loadFeatureGraphicContext,
  resolveLocaleFeatureGraphicTexts,
  type FeatureGraphicContext,
  type LocaleFeatureGraphic,
} from "./feature-graphic-store";

export * from "./feature-graphic-layout";
export * from "./feature-graphic-store";

const JPEG_QUALITY = 90;
// Texte toujours dans la zone de sécurité (recadrage horizontal du Play Store).
const PAD_X = SAFE_MARGIN_X;
const PAD_Y = 64;
// Les largeurs de glyphes sont estimées (charAdvance): marge contre le débordement.
const WIDTH_SAFETY = 0.94;

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
  const fitWidth = Math.floor(colWidth * WIDTH_SAFETY);
  const badgeSize = texts.badges.length > 0 ? fitBadgeFontSize(texts.badges, fitWidth) : 0;
  // Réserve verticale des badges: au plus deux rangées (fitBadgeFontSize).
  const badgeReserve = texts.badges.length > 0 ? Math.round((badgeSize + 18) * 2 + 10 + 24) : 0;
  const headlineSize = texts.headline
    ? fitHeadlineFontSize({
        text: texts.headline,
        maxWidth: fitWidth,
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
              // RTL: premier badge à droite (row-reverse part du bord droit).
              flexDirection: rtl ? "row-reverse" : "row",
              justifyContent: "flex-start",
              marginTop: texts.headline ? 24 : 0,
            }}
          >
            {texts.badges.map((badge, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  marginRight: rtl ? 0 : BADGE_GAP,
                  marginLeft: rtl ? BADGE_GAP : 0,
                  marginBottom: BADGE_GAP,
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

/** Rend et enregistre la bannière d'une langue avec des textes déjà résolus. */
export async function saveLocaleFeatureGraphic(
  ctx: FeatureGraphicContext,
  opts: { locale: string; texts: FeatureGraphicTexts; manual: boolean; listingTitle?: string | null }
): Promise<LocaleFeatureGraphic> {
  const jpeg = await renderFeatureGraphic({
    template: ctx.template,
    texts: opts.texts,
    artDataUrl: ctx.artDataUrl,
    locale: opts.locale,
  });
  const stored: StoredFeatureGraphic = {
    ...opts.texts,
    manual: opts.manual,
    fingerprint: featureGraphicFingerprint(ctx, opts.manual, opts.listingTitle),
  };
  const paths = localeFeatureGraphicPaths(ctx.projectId, opts.locale);
  saveFile(paths.image, jpeg);
  saveFile(paths.texts, Buffer.from(JSON.stringify(stored, null, 2)));
  return {
    locale: opts.locale,
    url: `/api/files/${paths.image}?v=${Date.now()}`,
    texts: opts.texts,
    manual: opts.manual,
  };
}

/** Résout les textes puis rend et enregistre la bannière d'une langue. */
export async function generateLocaleFeatureGraphic(opts: {
  projectId: string;
  sourceLocale: string;
  locale: string;
  listingTitle?: string | null;
  texts?: FeatureGraphicTexts;
  resetManual?: boolean;
}): Promise<LocaleFeatureGraphic> {
  const ctx = loadFeatureGraphicContext(opts.projectId);
  const { texts, manual } = await resolveLocaleFeatureGraphicTexts(ctx, opts);
  return saveLocaleFeatureGraphic(ctx, {
    locale: opts.locale,
    texts,
    manual,
    listingTitle: opts.listingTitle,
  });
}
