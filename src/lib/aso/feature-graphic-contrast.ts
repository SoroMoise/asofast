/**
 * Lisibilité du texte de la bannière: contraste entre la couleur du texte et ce
 * qui est réellement derrière la colonne de texte (fond + illustration
 * composés), pas seulement la couleur de fond: l'illustration la recouvre
 * souvent.
 */
import sharp from "sharp";

import {
  FEATURE_GRAPHIC_HEIGHT as H,
  FEATURE_GRAPHIC_WIDTH as W,
  LOW_CONTRAST_WARN_SHARE,
  lowContrastShare,
  textColumnBox,
  type FeatureGraphicTemplate,
} from "./feature-graphic-layout";

export type TextContrast = {
  /** Part (0–1) de la colonne de texte sous le contraste minimal. */
  lowShare: number;
  warn: boolean;
};

/** Fond du rendu (même dégradé à 135° que la bannière) en SVG. */
function backgroundSvg(tpl: FeatureGraphicTemplate): Buffer {
  const to = tpl.backgroundGradientTo ?? tpl.backgroundColor;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${tpl.backgroundColor}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`
  );
}

export async function measureTextContrast(
  template: FeatureGraphicTemplate,
  art: Buffer
): Promise<TextContrast> {
  const layer = await sharp(art).resize(W, H, { fit: "cover" }).png().toBuffer();
  const composed = await sharp(backgroundSvg(template))
    .composite([{ input: layer }])
    .png()
    .toBuffer();
  const box = textColumnBox(template);
  // Échantillon réduit: la proportion de pixels suffit, pas le détail.
  const { data, info } = await sharp(composed)
    .extract(box)
    .resize({ width: 96 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lowShare = lowContrastShare(new Uint8Array(data), info.channels, template.textColor);
  return { lowShare, warn: lowShare > LOW_CONTRAST_WARN_SHARE };
}
