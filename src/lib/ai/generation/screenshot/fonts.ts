/**
 * Font loader for screenshot rendering (Satori via next/og needs TTF buffers).
 * We ship a single curated family (Poppins) in three weights; the extracted
 * competitor style picks a weight. Fetched once from a CDN and cached in memory.
 */
import { mapWithConcurrency } from "@/lib/concurrency";

const FONT_URLS = {
  regular: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Regular.ttf",
  semibold: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-SemiBold.ttf",
  bold: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Bold.ttf",
} as const;

// Budget de telechargement d'UNE police, en DEUX laisses distinctes.
//
// Un `AbortSignal` passe a fetch() ne couvre pas que la poignee de main: il
// continue de courir pendant `res.arrayBuffer()`. Une laisse unique de 10s
// tuait donc la lecture du corps des polices CJK (SC = 8,3 Mo, TC/HK = 5,7 Mo,
// que le pipeline mesure jusqu'a 30s en prod), et zh-CN / zh-TW / zh-HK
// echouaient systematiquement alors que l'URL repondait.
//
// On separe: HEADERS borne la connexion et le premier octet, BODY borne le
// transfert (assez large pour 8 Mo sur un lien lambda mediocre). HEADERS reste a
// 10s, exactement le plafond que l'ancien reglage accordait a la connexion: une
// URL morte coute toujours ~21s (2 x 10s + backoff), et aucune poignee de main
// qui passait avant ne se met a echouer.
const FONT_FETCH_ATTEMPTS = 2;
const FONT_HEADERS_TIMEOUT_MS = 10_000;
const FONT_BODY_TIMEOUT_MS = 45_000;
// Prechauffage: assez large pour que le lot parte vite, assez etroit pour ne pas
// mettre ~45 Mo en vol d'un coup (lien du lambda sature, rate-limit du CDN).
const FONT_WARM_CONCURRENCY = 4;
// Memoire courte des echecs. Sans elle, chaque appelant arrivant apres le
// `cache.delete` rejouait la sequence complete de tentatives sur une URL
// systematiquement morte: N langues x le budget entier.
const FONT_FAILURE_TTL_MS = 60_000;

// Dedup EN VOL: on cache la Promise, pas seulement le buffer resolu. Les polices
// CJK sont volumineuses (SC = 8 Mo) et plusieurs langues demandent la meme au
// meme instant (zh-CN -> SC). Cacher la Promise fait partager UN seul
// telechargement au lieu de N simultanes (cause des timeouts en prod sur 80+
// langues en parallele). Une Promise rejetee est retiree pour autoriser un retry.
const cache = new Map<string, Promise<ArrayBuffer>>();
const failedAt = new Map<string, number>();

/** Un corps qui cale apres des en-tetes valides ne se rejoue pas: la tentative
 *  suivante paierait le meme budget pour le meme resultat. Ce marqueur sort de
 *  la boucle de retry sans consommer un second BODY_TIMEOUT. */
class FontBodyTimeout extends Error {}

/** Une tentative: en-tetes sous une laisse courte, corps sous une laisse longue. */
async function fetchFontAttempt(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), FONT_HEADERS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Font fetch failed (${res.status} ${res.statusText}): ${url}`);
    // En-tetes recues: on rearme sur le budget de transfert.
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), FONT_BODY_TIMEOUT_MS);
    try {
      return await res.arrayBuffer();
    } catch (err) {
      if (controller.signal.aborted) {
        throw new FontBodyTimeout(`Font body stalled after ${FONT_BODY_TIMEOUT_MS}ms: ${url}`);
      }
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFontOnce(url: string): Promise<ArrayBuffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FONT_FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchFontAttempt(url);
    } catch (err) {
      lastError = err;
      // La cause reelle (timeout d'en-tetes, 429 du CDN, corps cale, reset) etait
      // jusqu'ici jetee ici meme: l'appelant ne voyait qu'un nom de police dans
      // `missing`. On la trace, sinon le prochain incident se rediagnostique a l'aveugle.
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`[fonts] attempt ${attempt}/${FONT_FETCH_ATTEMPTS} failed: ${reason}`);
      if (err instanceof FontBodyTimeout) break;
      // Backoff + jitter entre tentatives: laisse passer une saturation reseau/CDN
      // transitoire au lieu de re-tenter dans la meme fenetre.
      if (attempt < FONT_FETCH_ATTEMPTS) {
        const delay = 400 * attempt + Math.floor(Math.random() * 400);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`Font fetch failed: ${url}`, { cause: lastError });
}

function fetchFont(url: string): Promise<ArrayBuffer> {
  const cached = cache.get(url);
  if (cached) return cached;

  const failed = failedAt.get(url);
  if (failed !== undefined && Date.now() - failed < FONT_FAILURE_TTL_MS) {
    return Promise.reject(new Error(`Font unreachable (cached failure): ${url}`));
  }

  const p = fetchFontOnce(url).catch((err: unknown) => {
    cache.delete(url);
    failedAt.set(url, Date.now());
    throw err;
  });
  cache.set(url, p);
  // Un succes efface le marqueur d'echec. Le second handler evite une rejection
  // non geree quand personne d'autre n'attend encore cette Promise.
  void p.then(
    () => failedAt.delete(url),
    () => {}
  );
  return p;
}

export type LoadedFonts = {
  regular: ArrayBuffer;
  semibold: ArrayBuffer;
  bold: ArrayBuffer;
};

/**
 * Poppins dans ses trois graisses. Tolerant a l'echec PARTIEL: si une graisse
 * ne se telecharge pas, on reutilise une graisse chargee plutot que de perdre la
 * langue entiere. Un `Poppins-SemiBold.ttf` injoignable a deja fait echouer des
 * langues qui n'avaient aucun probleme de rendu (id, hi-IN, hu-HU en prod).
 * Seul l'echec des TROIS graisses est fatal: sans police latine, rien a dessiner.
 */
export async function loadFonts(): Promise<LoadedFonts> {
  const settled = await Promise.allSettled([
    fetchFont(FONT_URLS.regular),
    fetchFont(FONT_URLS.semibold),
    fetchFont(FONT_URLS.bold),
  ]);
  const [regular, semibold, bold] = settled;
  const loaded = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (loaded.length === 0) {
    throw new Error("Font fetch failed for every Poppins weight.");
  }
  const pick = (r: PromiseSettledResult<ArrayBuffer>): ArrayBuffer =>
    r.status === "fulfilled" ? r.value : loaded[0];
  return { regular: pick(regular), semibold: pick(semibold), bold: pick(bold) };
}

/**
 * Couche polices par script (non latin).
 *
 * Sans police fournie pour une ecriture, satori va chercher une police de secours
 * EN RESEAU au moment du rendu (lent, timeouts en prod), et quand ce fetch echoue
 * @vercel/og avale l'erreur: la caption part alors en carres vides sans qu'aucune
 * erreur ne remonte. On fournit donc explicitement la bonne police.
 *
 * LIMITE DU MOTEUR, a connaitre avant de toucher a cette table. next/og n'embarque
 * PAS fontkit mais opentype.js, qui n'a ni shaper indien ni Universal Shaping
 * Engine. Il mappe codepoint par codepoint. Les ecritures brahmiques (devanagari,
 * bengali, gujarati, gurmukhi, tamoul, telougou, kannada, malayalam, singhalais,
 * khmer, lao, birman) ne sont donc PAS composees correctement: une voyelle
 * pre-base reste apres sa consonne (दिन rendu दनि) et les matras isolees sortent
 * avec leur cercle pointille. Aucune police ne repare ca. Les polices ci-dessous
 * suppriment le repli reseau et les carres vides, mais le texte de ces ecritures
 * reste mal compose tant qu'on ne pre-shape pas (harfbuzz) en amont.
 * Rendent correctement: latin, cyrillique, grec, hebreu, arabe/persan/ourdou
 * (opentype.js a un module bidi + arabe), thai, armenien, georgien, ethiopien, CJK.
 *
 * Deux pieges verifies empiriquement (rendu reel via next/og, reseau coupe,
 * plusieurs captions par ecriture):
 *
 *  1. opentype.js throw sur `lookupType 5 - substFormat 3` QUAND il applique ce
 *     lookup, ce qu'il ne fait que sur l'ecriture arabe. Toutes les Noto arabes
 *     (Sans, Naskh, Kufi), Amiri, Harmattan, Lateef et Scheherazade le portent et
 *     font echouer le rendu. Vazirmatn ne l'a pas, couvre l'arabe, le persan et
 *     l'ourdou, et rend les trois sans repli reseau. Le meme lookup dans une
 *     police indienne est INOFFENSIF (jamais applique): on garde donc les Noto,
 *     implementation de reference, qui seront correctes le jour du pre-shaping.
 *
 *  2. opentype.js throw sur les polices VARIABLES (`Famille[wght].ttf`), avec un
 *     `Cannot read properties of undefined`. Ne pointer que vers des instances
 *     statiques. C'est ce qui disqualifie AnekBangla, BalooDa2, BalooTamma2,
 *     BalooChettan2, GemunuLibre et le Vazirmatn de Google Fonts.
 *
 * next/og accepte ttf/otf mais PAS woff2. Toutes les URLs sont des .ttf ou .otf.
 */
const SCRIPT_FONT_URLS = {
  // NotoSans couvre latin + cyrillique + grec dans un seul fichier.
  latin: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
  // Vazirmatn (instance statique du depot amont, PAS le fichier variable de
  // Google Fonts) et pas une Noto arabe: cf. piege 1 ci-dessus. Tajawal, l'ancien
  // choix, ne couvrait que 7 des 16 codepoints d'une caption ourdoue: il manquait
  // ٹ چ ک گ ں ھ ہ ی ے, c'est-a-dire tout ce qui distingue l'ourdou et le persan
  // de l'arabe. D'ou les "Failed to load dynamic font" sur ur, fa, fa-IR, fa-AE.
  arabic: "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/ttf/Vazirmatn-Regular.ttf",
  hebrew: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansHebrew/hinted/ttf/NotoSansHebrew-Regular.ttf",
  thai: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansThai/hinted/ttf/NotoSansThai-Regular.ttf",

  // Brahmiques. Poppins couvre le devanagari (glyphes presents), les autres non.
  // ATTENTION: fournir la police supprime les carres vides et le repli reseau,
  // mais opentype.js ne les compose pas (cf. LIMITE DU MOTEUR ci-dessus). On
  // choisit donc les Noto, seule famille qui couvre toutes ces ecritures avec un
  // GSUB complet: elles seront correctes des qu'un vrai shaper les alimentera.
  bengali: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Regular.ttf",
  gujarati: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansGujarati/hinted/ttf/NotoSansGujarati-Regular.ttf",
  gurmukhi: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansGurmukhi/hinted/ttf/NotoSansGurmukhi-Regular.ttf",
  tamil: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansTamil/hinted/ttf/NotoSansTamil-Regular.ttf",
  telugu: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansTelugu/hinted/ttf/NotoSansTelugu-Regular.ttf",
  kannada: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansKannada/hinted/ttf/NotoSansKannada-Regular.ttf",
  malayalam: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansMalayalam/hinted/ttf/NotoSansMalayalam-Regular.ttf",
  sinhala: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansSinhala/hinted/ttf/NotoSansSinhala-Regular.ttf",
  lao: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansLao/hinted/ttf/NotoSansLao-Regular.ttf",
  khmer: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansKhmer/hinted/ttf/NotoSansKhmer-Regular.ttf",
  myanmar: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansMyanmar/hinted/ttf/NotoSansMyanmar-Regular.ttf",

  armenian: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansArmenian/hinted/ttf/NotoSansArmenian-Regular.ttf",
  georgian: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansGeorgian/hinted/ttf/NotoSansGeorgian-Regular.ttf",
  ethiopic: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansEthiopic/hinted/ttf/NotoSansEthiopic-Regular.ttf",

  // CJK: fichiers dedies (volumineux: SC ~8 Mo, TC/HK ~5,5 Mo, JP/KR ~4,5 Mo).
  // Epingles sur un TAG de version (pas @main): jsdelivr met les tags en cache
  // edge, alors qu'une branche est refetchee live depuis GitHub (lent / timeouts
  // sur ces gros fichiers en prod). Ne pas repasser sur @main sans raison.
  sc: "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
  tc: "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@Sans2.004/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf",
  hk: "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@Sans2.004/Sans/SubsetOTF/HK/NotoSansHK-Regular.otf",
  jp: "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@Sans2.004/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf",
  kr: "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@Sans2.004/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf",
} as const;

type FontKey = keyof typeof SCRIPT_FONT_URLS;

// Nom de famille expose a Satori pour chaque police. Le nom sert de cle dans la
// pile fontFamily cote render: cette table reste la seule source du couple
// (nom, url), pour garder l'entree fonts et le fontFamily synchronises.
const FONT_META: Record<FontKey, { name: string; url: string }> = {
  latin: { name: "NotoSans", url: SCRIPT_FONT_URLS.latin },
  arabic: { name: "Vazirmatn", url: SCRIPT_FONT_URLS.arabic },
  hebrew: { name: "NotoSansHebrew", url: SCRIPT_FONT_URLS.hebrew },
  thai: { name: "NotoSansThai", url: SCRIPT_FONT_URLS.thai },
  bengali: { name: "NotoSansBengali", url: SCRIPT_FONT_URLS.bengali },
  gujarati: { name: "NotoSansGujarati", url: SCRIPT_FONT_URLS.gujarati },
  gurmukhi: { name: "NotoSansGurmukhi", url: SCRIPT_FONT_URLS.gurmukhi },
  tamil: { name: "NotoSansTamil", url: SCRIPT_FONT_URLS.tamil },
  telugu: { name: "NotoSansTelugu", url: SCRIPT_FONT_URLS.telugu },
  kannada: { name: "NotoSansKannada", url: SCRIPT_FONT_URLS.kannada },
  malayalam: { name: "NotoSansMalayalam", url: SCRIPT_FONT_URLS.malayalam },
  sinhala: { name: "NotoSansSinhala", url: SCRIPT_FONT_URLS.sinhala },
  lao: { name: "NotoSansLao", url: SCRIPT_FONT_URLS.lao },
  khmer: { name: "NotoSansKhmer", url: SCRIPT_FONT_URLS.khmer },
  myanmar: { name: "NotoSansMyanmar", url: SCRIPT_FONT_URLS.myanmar },
  armenian: { name: "NotoSansArmenian", url: SCRIPT_FONT_URLS.armenian },
  georgian: { name: "NotoSansGeorgian", url: SCRIPT_FONT_URLS.georgian },
  ethiopic: { name: "NotoSansEthiopic", url: SCRIPT_FONT_URLS.ethiopic },
  sc: { name: "NotoSansSC", url: SCRIPT_FONT_URLS.sc },
  tc: { name: "NotoSansTC", url: SCRIPT_FONT_URLS.tc },
  hk: { name: "NotoSansHK", url: SCRIPT_FONT_URLS.hk },
  jp: { name: "NotoSansJP", url: SCRIPT_FONT_URLS.jp },
  kr: { name: "NotoSansKR", url: SCRIPT_FONT_URLS.kr },
};

/** Une plage Unicode par ecriture, exprimee avec les glyphes de borne. Les
 *  bornes sont verifiees par codepoint, pas a l'oeil: un glyphe de borne se
 *  copie mal (les lignes RTL se reordonnent a l'affichage). */
const SCRIPT_RANGES: { key: FontKey; re: RegExp }[] = [
  // Arabe: bloc de base, supplement, extended-A, formes de presentation A/B.
  // Couvre aussi l'ourdou et le persan (leurs lettres vivent dans U+0600-06FF).
  { key: "arabic", re: /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/ },
  // Hebreu (+ formes de presentation alphabetiques).
  { key: "hebrew", re: /[֐-׿יִ-ﭏ]/ },
  { key: "thai", re: /[฀-๿]/ },
  { key: "bengali", re: /[ঀ-৿]/ },
  { key: "gurmukhi", re: /[਀-੿]/ },
  { key: "gujarati", re: /[઀-૿]/ },
  { key: "tamil", re: /[஀-௿]/ },
  { key: "telugu", re: /[ఀ-౿]/ },
  { key: "kannada", re: /[ಀ-೿]/ },
  { key: "malayalam", re: /[ഀ-ൿ]/ },
  { key: "sinhala", re: /[඀-෿]/ },
  { key: "lao", re: /[຀-໿]/ },
  { key: "myanmar", re: /[က-႟]/ },
  { key: "khmer", re: /[ក-៿]/ },
  { key: "armenian", re: /[԰-֏]/ },
  // Georgien: Mkhedruli + Mtavruli (majuscules, bloc separe).
  { key: "georgian", re: /[Ⴀ-ჿᲐ-Ჿ]/ },
  { key: "ethiopic", re: /[ሀ-᎟]/ },
  // Devanagari: couvert par Poppins (pas de cle dediee, cf. SCRIPT_FONT_URLS).
  // Cyrillique (+ supplement) et grec (+ grec etendu): couverts par NotoSans.
  { key: "latin", re: /[Ѐ-ԯ]/ },
  { key: "latin", re: /[Ͱ-Ͽἀ-῿]/ },
  // Latin Extended Additional (U+1E00-1EFF) = le vietnamien (ế, ộ, ừ, ị...).
  // Poppins s'arrete a Latin Extended-B: ses sous-ensembles Google sont latin,
  // latin-ext et devanagari, PAS vietnamese. Sans cette ligne, `vi` ne declenche
  // aucune police de script et part en carres vides. NotoSans couvre le bloc.
  //
  // Ca ne se voyait pas tant que le rendu passait par next/og: son
  // `loadDynamicAsset` allait chercher une police sur le reseau pour tout glyphe
  // orphelin. C'est ce fetch qui mourait en prod ("Failed to load dynamic font
  // for ừ", UND_ERR_SOCKET). La pile de polices doit etre complete par elle-meme.
  { key: "latin", re: /[Ḁ-ỿ]/ },
];

/** Le Han seul ne dit ni la langue ni la variante: seule la locale tranche.
 *
 *  Simplifie vs traditionnel: sans ca, zh-TW et zh-HK recevaient NotoSansSC et
 *  rendaient des formes simplifiees.
 *
 *  Japonais et coreen: une caption peut n'etre QUE des kanji/hanja, sans kana ni
 *  hangul ("写真編集"). Le detecteur tombe alors sur cette fonction, qui renvoyait
 *  "sc": le japonais partait en formes chinoises simplifiees, et le prechauffage
 *  (qui, lui, part de la langue) avait charge NotoSansJP -> police manquante au
 *  rendu. Les deux chemins doivent s'accorder sur la langue. */
function hanFontKey(locale: string | undefined): FontKey {
  const l = (locale ?? "").toLowerCase();
  if (l.startsWith("ja")) return "jp";
  if (l.startsWith("ko")) return "kr";
  if (l.startsWith("zh-hk") || l.startsWith("zh-mo")) return "hk";
  if (l.startsWith("zh-tw") || l.includes("hant")) return "tc";
  return "sc";
}

/**
 * Detecte les scripts non latins presents et renvoie les polices a charger.
 * Une caption purement latine (ou devanagari) renvoie [] (aucun fetch, chemin
 * rapide intact). `locale` ne sert qu'a arbitrer le Han (cf. hanFontKey).
 */
function detectFontKeys(text: string, locale?: string): FontKey[] {
  const keys = new Set<FontKey>();
  for (const { key, re } of SCRIPT_RANGES) {
    if (re.test(text)) keys.add(key);
  }

  // CJK: l'ordre compte. Le japonais melange kana + kanji (Han), le coreen
  // melange hangul + hanja (Han). On resout donc le Han via la langue quand
  // elle est identifiable, sinon on retombe sur le chinois (simplifie par defaut).
  const hasKana = /[぀-ヿ]/.test(text);
  const hasHangul = /[가-힯ᄀ-ᇿ㄰-㆏]/.test(text);
  const hasHan = /[一-鿿㐀-䶿豈-﫿]/.test(text);

  if (hasKana) keys.add("jp"); // Japonais: NotoSansJP couvre kana + kanji.
  if (hasHangul) keys.add("kr"); // Coreen: NotoSansKR couvre hangul + hanja.
  if (hasHan && !hasKana && !hasHangul) keys.add(hanFontKey(locale));

  return [...keys];
}

/**
 * Script attendu pour une langue, quand la langue suffit a le deduire.
 *
 * Sert UNIQUEMENT au prechauffage (`warmFonts`), jamais au rendu: la detection
 * par le texte (`detectFontKeys`) reste la seule autorite. Une langue absente de
 * cette table ne casse donc rien, elle retombe sur le telechargement paresseux
 * d'avant. `loadScriptFonts` journalise ce cas: un "cold fetch" pendant le
 * fan-out veut dire qu'il manque une entree ici.
 *
 * Le devanagari (hi, mr, ne) n'y figure pas: Poppins le couvre deja.
 */
const LOCALE_SCRIPT: Record<string, FontKey> = {
  // Cyrillique, grec et vietnamien vivent dans NotoSans, comme le latin.
  ru: "latin", uk: "latin", be: "latin", bg: "latin", sr: "latin",
  mk: "latin", mn: "latin", kk: "latin", ky: "latin", tg: "latin",
  el: "latin", vi: "latin",

  ar: "arabic", fa: "arabic", ur: "arabic", ps: "arabic",
  he: "hebrew", iw: "hebrew", // `iw` est l'ancien code ISO de l'hebreu, encore emis.
  th: "thai",

  bn: "bengali", gu: "gujarati", pa: "gurmukhi", ta: "tamil", te: "telugu",
  kn: "kannada", ml: "malayalam", si: "sinhala", lo: "lao", km: "khmer", my: "myanmar",

  hy: "armenian", ka: "georgian", am: "ethiopic", ti: "ethiopic",

  ja: "jp", ko: "kr",
};

/** Polices de script attendues pour une langue. `zh` passe par hanFontKey, seule
 *  la langue distinguant Han simplifie et traditionnel. */
function scriptFontKeysForLocale(locale: string): FontKey[] {
  const lang = locale.toLowerCase().split(/[-_]/)[0];
  if (lang === "zh") return [hanFontKey(locale)];
  const key = LOCALE_SCRIPT[lang];
  return key ? [key] : [];
}

/**
 * Precharge Poppins + toutes les polices de script du lot, AVANT que le moindre
 * rendu ne commence.
 *
 * Pourquoi: satori pose la mise en page sur la boucle d'evenements, et le lot
 * enchaine une locale apres l'autre. Une police telechargee PENDANT le fan-out
 * partage donc sa fenetre avec le rendu des locales voisines, et un corps
 * volumineux (NotoSansSC = 8,3 Mo) a d'autant plus d'occasions de se faire
 * couper. Un echec etant memorise 60s (FONT_FAILURE_TTL_MS), UNE police perdue
 * condamnait d'un coup toutes les langues qui la partagent (NotoSans -> el, kk,
 * ky, mk, mn, ru, uk, vi).
 *
 * Ici la boucle est libre: les telechargements aboutissent, et le cache memoire
 * sert ensuite toutes les locales sans jamais retoucher le reseau.
 *
 * C'etait vital du temps de next/og, dont le resvg WASM synchrone gelait la
 * boucle des dizaines de secondes d'affilee. La rasterisation est passee sur le
 * threadpool (cf. render.tsx), mais precharger reste la bonne facon de ne payer
 * chaque police qu'une fois par lot.
 *
 * Concurrence bornee: evite d'ouvrir ~20 fetchs d'un coup (jusqu'a ~45 Mo en
 * vol), ce qui sature le lien du lambda et expose au rate-limit du CDN.
 * Ne throw jamais: une police qui manque encore sera signalee par la locale
 * concernee, via `missing`, et n'emporte pas les autres.
 */
export async function warmFonts(locales: string[]): Promise<void> {
  const keys = new Set(locales.flatMap(scriptFontKeysForLocale));
  const urls = [...keys].map((key) => FONT_META[key].url);
  const tasks: (() => Promise<unknown>)[] = [
    () => loadFonts(),
    ...urls.map((url) => () => fetchFont(url)),
  ];
  const t = performance.now();
  const settled = await mapWithConcurrency(tasks, FONT_WARM_CONCURRENCY, (task) =>
    task().then(
      () => true,
      () => false
    )
  );
  const failed = settled.filter((ok) => !ok).length;
  console.log(
    `[fonts] warm: ${settled.length - failed}/${settled.length} loaded in ${Math.round(performance.now() - t)}ms` +
      (failed > 0 ? ` (${failed} failed)` : "")
  );
}

export type ScriptFont = { name: string; data: ArrayBuffer };
/** `missing` liste les polices dont le telechargement a echoue. Non vide = la
 *  caption partirait en carres vides: l'appelant doit echouer, pas livrer ca. */
export type ScriptFonts = { fonts: ScriptFont[]; missing: string[] };

/**
 * Renvoie les polices a fournir a Satori pour cette caption (une entree par
 * script non latin detecte). Un seul poids Regular par police: suffisant pour
 * les scripts non latins, le "bold" degrade proprement.
 * Ne throw JAMAIS: un echec reseau se lit dans `missing`, ce qui laisse
 * l'appelant decider (echouer la langue plutot que livrer un rendu vide).
 */
export async function loadScriptFonts(text: string, locale?: string): Promise<ScriptFonts> {
  const keys = detectFontKeys(text, locale);
  // Une police absente du cache ici part en telechargement pendant que les
  // locales voisines rasterisent: c'est exactement ce que `warmFonts` doit
  // empecher. Le signal designe l'entree manquante de LOCALE_SCRIPT.
  for (const key of keys) {
    if (!cache.has(FONT_META[key].url)) {
      console.warn(`[fonts] cold fetch during render: ${FONT_META[key].name} (locale=${locale})`);
    }
  }
  const settled = await Promise.allSettled(keys.map((key) => fetchFont(FONT_META[key].url)));

  const fonts: ScriptFont[] = [];
  const missing: string[] = [];
  settled.forEach((result, i) => {
    const meta = FONT_META[keys[i]];
    if (result.status === "fulfilled") fonts.push({ name: meta.name, data: result.value });
    else missing.push(meta.name);
  });
  return { fonts, missing };
}
