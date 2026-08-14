/**
 * Compression d'image cote client (canvas), avant tout upload vers le bucket.
 *
 * Objectif: aucune image importee par l'utilisateur ne depasse ~1 MB une fois
 * stockee. On compresse dans le navigateur, PAS au serveur: ca allege l'upload
 * lui-meme (browser -> Supabase), l'entree vision (OpenAI lit la source telle
 * quelle) et le telechargement de generation. Le poids des uploads est nomme
 * comme un vrai correctif des timeouts de generation (cf. api/.../generate).
 *
 * Deux leviers pour atteindre la cible:
 *  - opaque (ou alpha interdit): JPEG, on baisse la qualite puis on reduit les
 *    pixels si besoin.
 *  - alpha reel: PNG (le canvas n'a pas de bouton qualite PNG), on reduit donc
 *    les pixels. La transparence est conservee pour que le degrade de la
 *    generation reste visible derriere le screenshot.
 *
 * Le format de sortie est TOUJOURS png ou jpeg (jamais webp): la source part
 * telle quelle dans satori/resvg au rendu, qui ne decode webp de facon sure. Un
 * webp importe est donc renormalise ici.
 */

/** Cible par defaut: viser ~1 MB (choix produit). */
const DEFAULT_MAX_BYTES = 1024 * 1024;
/** Plafond du plus grand cote d'un screenshot: couvre la plus grande frame store
 *  (iPhone 6.9" 2796 px). Une source plus grande n'apporte rien: la generation
 *  redimensionne en "contain" dans la frame. */
export const SCREENSHOT_MAX_EDGE = 2800;

const QUALITY_START = 0.92;
const QUALITY_FLOOR = 0.5;
const QUALITY_STEP = 0.08;
/** Apres une reduction de pixels, on repart un cran plus haut en qualite. */
const QUALITY_AFTER_DOWNSCALE = 0.82;
const DOWNSCALE_FACTOR = 0.85;
const MIN_EDGE = 400;
/** Filet anti-boucle: largement au-dessus du pire cas reel (2800 -> 400 px). */
const MAX_ITERATIONS = 24;

export type ImgFormat = "png" | "jpg";

export type CompressOutcome = {
  blob: Blob;
  ext: ImgFormat;
  contentType: "image/png" | "image/jpeg";
  originalBytes: number;
  finalBytes: number;
  /** false = octets d'origine renvoyes intacts (deja sous budget, format sur). */
  compressed: boolean;
};

export type CompressOptions = {
  /** Budget en octets (defaut ~1 MB). */
  maxBytes?: number;
  /** Boite de sortie fixe (icone 512x512, feature graphic 1024x500). La source
   *  est dessinee en "contain" (ratio preserve, centree). */
  fit?: { width: number; height: number };
  /** Plafond du plus grand cote quand il n'y a pas de `fit` (screenshots). */
  maxEdge?: number;
  /** false force un JPEG opaque (feature graphic: Play interdit l'alpha). */
  allowAlpha?: boolean;
  /** Force le format de sortie au lieu de le deduire de l'alpha. L'icone Play
   *  DOIT rester PNG (icone hi-res PNG only): on suit la source (png -> png). */
  forceFormat?: ImgFormat;
  /** Remplissage quand la sortie est opaque (defaut blanc). */
  background?: string;
};

// --- helpers purs (testables sans canvas) ---

/** Reduit (jamais n'agrandit) pour que le plus grand cote tienne dans maxEdge. */
export function scaleToMaxEdge(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const k = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Rectangle "contain" d'une source centree dans une boite (ratio preserve). */
export function containRect(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number
): { dx: number; dy: number; dw: number; dh: number } {
  const k = Math.min(boxW / srcW, boxH / srcH);
  const dw = Math.round(srcW * k);
  const dh = Math.round(srcH * k);
  return { dx: Math.round((boxW - dw) / 2), dy: Math.round((boxH - dh) / 2), dw, dh };
}

/** PNG seulement si l'alpha est reel ET autorise; sinon JPEG. */
export function pickExt(hasAlpha: boolean, allowAlpha: boolean): ImgFormat {
  return allowAlpha && hasAlpha ? "png" : "jpg";
}

/** Taille lisible ("5.2 MB", "900 KB"). */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// --- plomberie canvas ---

function getCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible.");
  return ctx;
}

/**
 * Dessine la source aux dimensions demandees. `contain` centre en preservant le
 * ratio (boite fixe); sinon on remplit toute la surface (screenshots). `fill`
 * peint un fond opaque avant le dessin (JPEG, ou padding du "contain").
 */
function drawFrame(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  contain: boolean,
  fill: string | null
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = getCtx(canvas);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
  }
  if (contain) {
    const r = containRect(bitmap.width, bitmap.height, w, h);
    ctx.drawImage(bitmap, r.dx, r.dy, r.dw, r.dh);
  } else {
    ctx.drawImage(bitmap, 0, 0, w, h);
  }
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Encodage image echoue."))),
      type,
      quality
    )
  );
}

/** Vrai des le premier pixel non totalement opaque (sortie anticipee). */
function hasAlphaPixels(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function outcome(
  blob: Blob,
  ext: ImgFormat,
  contentType: "image/png" | "image/jpeg",
  originalBytes: number
): CompressOutcome {
  return { blob, ext, contentType, originalBytes, finalBytes: blob.size, compressed: true };
}

/**
 * Compresse `file` pour tenir sous `maxBytes`, en png (si alpha reel + autorise)
 * ou jpeg. Renvoie les octets d'origine intacts quand ils sont deja sous budget,
 * au bon format (png/jpeg, pas webp) et aux bonnes dimensions.
 */
export async function compressImage(
  file: File,
  opts: CompressOptions = {}
): Promise<CompressOutcome> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowAlpha = opts.allowAlpha ?? true;
  const bg = opts.background ?? "#ffffff";
  const originalBytes = file.size;
  const isPngOrJpeg = file.type === "image/png" || file.type === "image/jpeg";

  const bitmap = await createImageBitmap(file);
  try {
    const srcW = bitmap.width;
    const srcH = bitmap.height;

    const target = opts.fit
      ? { w: opts.fit.width, h: opts.fit.height }
      : scaleToMaxEdge(srcW, srcH, opts.maxEdge ?? SCREENSHOT_MAX_EDGE);

    // Pass-through: format sur, deja sous budget, deja aux bonnes dimensions, et
    // compatible avec la contrainte alpha de la cible. Evite de re-encoder (le
    // PNG canvas n'est pas quantifie: re-encoder un PNG deja optimise peut le
    // GROSSIR). Un webp n'est jamais passe tel quel (renormalise plus bas).
    const dimsOk = opts.fit
      ? srcW === opts.fit.width && srcH === opts.fit.height
      : srcW === target.w && srcH === target.h;
    const formatOk = opts.forceFormat
      ? file.type === (opts.forceFormat === "png" ? "image/png" : "image/jpeg")
      : allowAlpha
        ? isPngOrJpeg
        : file.type === "image/jpeg";
    if (isPngOrJpeg && formatOk && dimsOk && originalBytes <= maxBytes) {
      const ext: ImgFormat = file.type === "image/png" ? "png" : "jpg";
      return {
        blob: file,
        ext,
        contentType: file.type as "image/png" | "image/jpeg",
        originalBytes,
        finalBytes: originalBytes,
        compressed: false,
      };
    }

    // Format de sortie: force si demande (icone: suit la source, un PNG reste
    // PNG), sinon deduit de l'alpha reel scanne aux dims cibles (screenshots),
    // sinon JPEG opaque (feature graphic). Le scan n'a lieu que pour l'auto.
    let ext: ImgFormat;
    if (opts.forceFormat) {
      ext = opts.forceFormat;
    } else if (allowAlpha) {
      const probe = drawFrame(bitmap, target.w, target.h, opts.fit != null, null);
      ext = pickExt(hasAlphaPixels(getCtx(probe), target.w, target.h), true);
    } else {
      ext = "jpg";
    }
    const contentType = ext === "png" ? "image/png" : "image/jpeg";

    let dims = { ...target };
    let quality = QUALITY_START;
    let best: Blob | null = null;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const fill = ext === "jpg" ? bg : null; // JPEG: fond opaque obligatoire.
      const canvas = drawFrame(bitmap, dims.w, dims.h, opts.fit != null, fill);
      const blob = await encode(canvas, contentType, ext === "jpg" ? quality : undefined);
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= maxBytes) return outcome(blob, ext, contentType, originalBytes);

      // Reduire: qualite JPEG d'abord, puis pixels. PNG (alpha) -> pixels direct.
      if (ext === "jpg" && quality - QUALITY_STEP >= QUALITY_FLOOR) {
        quality = Number((quality - QUALITY_STEP).toFixed(2));
        continue;
      }
      const canDownscale = !opts.fit && Math.max(dims.w, dims.h) > MIN_EDGE;
      if (!canDownscale) break; // plancher atteint: on renvoie le meilleur effort.
      dims = {
        w: Math.max(1, Math.round(dims.w * DOWNSCALE_FACTOR)),
        h: Math.max(1, Math.round(dims.h * DOWNSCALE_FACTOR)),
      };
      if (ext === "jpg") quality = QUALITY_AFTER_DOWNSCALE;
    }

    // best est non nul: la boucle tourne au moins une fois.
    return outcome(best as Blob, ext, contentType, originalBytes);
  } finally {
    bitmap.close();
  }
}
