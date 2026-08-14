import crypto from "node:crypto";

import { GoogleAuth, type JWTInput } from "google-auth-library";

import { mapWithConcurrency } from "@/lib/concurrency";

import { createGate } from "./gate";
import { fetchWithTimeout, withTimeout } from "./http";
import type {
  LocaleResult,
  PlayStoreCredentials,
  PublishProgress,
  PublishResult,
  StoreScreenshot,
  StoreUpdate,
} from "./types";

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const IMAGE_TYPE = "phoneScreenshots";
const IMAGE_TYPE_TABLET_7 = "sevenInchScreenshots";
const IMAGE_TYPE_TABLET_10 = "tenInchScreenshots";
const IMAGE_TYPE_ICON = "icon";
const IMAGE_TYPE_FEATURE_GRAPHIC = "featureGraphic";
const MAX_IMAGES = 8;

// Langues traitées en parallèle sur un même edit. KNOB.
const LOCALE_CONCURRENCY = 2;
// Plafond GLOBAL de requêtes Google réellement en vol pour tout le lot (langues
// × images confondues). Les uploads d'images sont BANDWIDTH-BOUND: trop de
// parallélisme partage la bande passante montante → chaque upload ralentit et
// dépasse son timeout. Volontairement bas. KNOB.
const GLOBAL_LIMIT = 3;

// Google Play impose des codes langue legacy pour quelques langues. Ex: l'hébreu
// n'est accepté QUE sous "iw-IL" (jamais l'ISO moderne "he"). Un code hors liste
// Play → PUT rejeté (400) → langue silencieusement absente de la fiche. On garde
// le code interne de l'app côté produit et on traduit juste avant l'appel Play.
const PLAY_LANGUAGE_OVERRIDES: Record<string, string> = {
  he: "iw-IL",
};
function toPlayLanguage(code: string): string {
  return PLAY_LANGUAGE_OVERRIDES[code] ?? code;
}

async function accessToken(serviceAccountJson: string): Promise<string> {
  let credentials: JWTInput;
  try {
    credentials = JSON.parse(serviceAccountJson) as JWTInput;
  } catch {
    throw new Error("Invalid service account JSON.");
  }
  const auth = new GoogleAuth({ credentials, scopes: [SCOPE] });
  // Borné: si les identifiants sont incomplets, google-auth peut retomber sur
  // le serveur de métadonnées GCE (injoignable hors GCP) et bloquer longtemps.
  const { token } = await withTimeout(
    (async () => {
      const client = await auth.getClient();
      return client.getAccessToken();
    })(),
    { timeoutMs: 20_000, label: "Google Play authentication" }
  );
  if (!token) throw new Error("Unable to get a Google Play token.");
  return token;
}

/** sha256 hex (minuscule) des octets exacts uploadés — même base que le champ
 *  sha256 renvoyé par Google (edits.images.list), pour diff sans ré-upload. */
function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Deux listes de hash identiques dans le même ordre (l'ordre compte à
 *  l'affichage du store). */
function sameImages(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((h, i) => h === b[i]);
}

/**
 * Update Google Play listing metadata + screenshots for one or more locales.
 * Only touches the store listing — never creates or promotes an app release.
 *
 * Publication par lots partageant UN SEUL edit: le 1er lot ouvre l'edit (aucun
 * `editId` fourni) et renvoie son id; les lots suivants le repassent via
 * `opts.editId`. Le commit (envoi en review Google) n'a lieu qu'au dernier lot
 * (`opts.commit`). Un run interrompu laisse l'edit non committé → rien publié
 * (le brouillon expire côté Google).
 */
export async function publishPlayStoreListings(
  creds: PlayStoreCredentials,
  packageName: string,
  updates: StoreUpdate[],
  onProgress?: PublishProgress,
  opts?: { editId?: string; commit?: boolean; changesNotSentForReview?: boolean }
): Promise<PublishResult> {
  const token = await accessToken(creds.serviceAccountJson);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Toutes les requêtes Google du lot passent par le gate: le plafond en vol est
  // global, jamais le produit langues × images.
  const gate = createGate(GLOBAL_LIMIT);
  const api = (
    url: string,
    init: RequestInit,
    o: { timeoutMs?: number; label: string }
  ): Promise<Response> =>
    gate.run(async () => {
      // 1 retry sur 429/5xx (échecs propres, réponse rapide). PAS de retry sur
      // timeout réseau: un POST d'upload non-idempotent pourrait créer un doublon.
      const res = await fetchWithTimeout(url, init, o);
      if (res.status !== 429 && res.status < 500) return res;
      await new Promise((r) => setTimeout(r, 1500));
      return fetchWithTimeout(url, init, o);
    });

  // Instrumentation (temporaire): révèle si le diff sha256 skippe réellement les
  // images inchangées. Si sets_uploaded reste élevé sur un republish sans
  // changement, c'est que Play renvoie un sha256 qui ne matche pas nos octets
  // source → il faudra tracker les hash uploadés côté DB.
  let setsSkipped = 0;
  let setsUploaded = 0;
  const t0 = performance.now();

  // Ouvre l'edit seulement au 1er lot; les suivants réutilisent le même id.
  const isFirstBatch = !opts?.editId;
  let editId = opts?.editId;
  if (!editId) {
    const editRes = await api(
      `${API}/${packageName}/edits`,
      { method: "POST", headers, cache: "no-store" },
      { timeoutMs: 30_000, label: "Google Play (opening the edit)" }
    );
    if (!editRes.ok) {
      throw new Error(`Google Play (edit ${editRes.status}): ${(await editRes.text()).slice(0, 300)}`);
    }
    const edit = (await editRes.json()) as { id?: string };
    editId = edit.id;
  }
  if (!editId) throw new Error("Google Play: edit identifier missing.");

  // Langue par défaut de la fiche (edits.details): le feature graphic ne s'upload
  // que sur cette langue, jamais sur toutes les locales. Repli sur la première
  // fiche du lot si l'API ne renvoie rien.
  let defaultLanguage: string | undefined;
  const detailsRes = await api(
    `${API}/${packageName}/edits/${editId}/details`,
    { headers },
    { timeoutMs: 30_000, label: "Google Play (listing default language)" }
  );
  if (detailsRes.ok) {
    defaultLanguage = ((await detailsRes.json()) as { defaultLanguage?: string }).defaultLanguage;
  }
  // Repli et comparaison en code Play (defaultLanguage vient de Play).
  const firstPlayLocale = updates[0]?.locale ? toPlayLanguage(updates[0].locale) : undefined;
  const globalAssetLocale = defaultLanguage ?? firstPlayLocale;
  const isDefaultLocale = (lang: string): boolean =>
    !!globalAssetLocale && lang.toLowerCase() === globalAssetLocale.toLowerCase();

  // Images déjà présentes pour ce type. `ok` distingue "Play a répondu, voici la
  // liste (éventuellement vide)" de "la lecture a échoué" — un jeu vide et une
  // erreur ne se traitent pas pareil (cf. le contrôle du feature graphic).
  async function listImages(
    lang: string,
    imageType: string
  ): Promise<{ ok: boolean; count: number; hashes: string[] }> {
    const res = await api(
      `${API}/${packageName}/edits/${editId}/listings/${encodeURIComponent(lang)}/${imageType}`,
      { headers },
      { timeoutMs: 30_000, label: `Google Play (${lang} ${imageType}: list)` }
    );
    if (!res.ok) return { ok: false, count: 0, hashes: [] };
    const body = (await res.json()) as { images?: { sha256?: string }[] };
    const images = body.images ?? [];
    return {
      ok: true,
      count: images.length,
      hashes: images.map((i) => i.sha256 ?? "").filter(Boolean),
    };
  }

  // Hash des images déjà présentes pour ce type (diff: skip si inchangé).
  async function existingImageHashes(lang: string, imageType: string): Promise<string[]> {
    // Lecture en échec → hashes vides → on ré-uploadera (comportement sûr).
    return (await listImages(lang, imageType)).hashes;
  }

  // Google Play refuse une fiche sans feature graphic. On ne bloque que s'il
  // manque DES DEUX CÔTÉS: aucun import dans le projet ET aucun déjà en place sur
  // la langue par défaut de la fiche. Contrôlé une seule fois (lot qui ouvre
  // l'edit), avant tout upload. Si Play ne répond pas (lecture en échec, langue
  // par défaut inconnue), on laisse passer: le commit tranchera.
  if (isFirstBatch && defaultLanguage && !updates.some((u) => u.featureGraphic)) {
    const remote = await listImages(defaultLanguage, IMAGE_TYPE_FEATURE_GRAPHIC);
    if (remote.ok && remote.count === 0) {
      throw new Error(
        "Feature graphic missing: upload it in the Feature graphic card before publishing."
      );
    }
  }

  // Remplace les images d'un type UNIQUEMENT si elles diffèrent des existantes.
  // Uploads SÉQUENTIELS dans un type: Google ordonne les images par ordre
  // d'arrivée (pas d'index dans l'API), donc du parallèle mélangerait l'ordre
  // d'affichage ET casserait le diff (les sha256 sont comparés dans l'ordre → un
  // ordre instable re-uploaderait à chaque publish). Le parallélisme se fait
  // entre types d'images et entre langues (voir processLocale + le gate global).
  async function replaceImages(
    lang: string,
    imageType: string,
    shots: StoreScreenshot[]
  ): Promise<{ count: number; changed: boolean }> {
    const limited = shots.slice(0, MAX_IMAGES);
    const localHashes = limited.map((s) => sha256(s.buffer));
    const remoteHashes = await existingImageHashes(lang, imageType);
    if (sameImages(localHashes, remoteHashes)) {
      setsSkipped++;
      return { count: limited.length, changed: false };
    }
    await api(
      `${API}/${packageName}/edits/${editId}/listings/${encodeURIComponent(lang)}/${imageType}`,
      { method: "DELETE", headers },
      { timeoutMs: 30_000, label: `Google Play (${lang} ${imageType}: delete)` }
    );
    for (const shot of limited) {
      const contentType = /\.jpe?g$/i.test(shot.fileName) ? "image/jpeg" : "image/png";
      const upRes = await api(
        `${UPLOAD}/${packageName}/edits/${editId}/listings/${encodeURIComponent(lang)}/${imageType}?uploadType=media`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
          body: new Uint8Array(shot.buffer),
        },
        { timeoutMs: 120_000, label: `Google Play (${lang} ${imageType}: upload image)` }
      );
      if (!upRes.ok) {
        throw new Error(`image ${upRes.status}: ${(await upRes.text()).slice(0, 200)}`);
      }
    }
    setsUploaded++;
    return { count: limited.length, changed: true };
  }

  // Traite une langue. Ne throw JAMAIS (mapWithConcurrency rejette au 1er throw
  // et abandonne les langues restantes): toute erreur est capturée par langue.
  async function processLocale(update: StoreUpdate): Promise<LocaleResult> {
    // Code interne de l'app (ex: "he") → code accepté par Play (ex: "iw-IL"). On
    // rapporte/retourne le code de l'app (ce que l'utilisateur a choisi), mais on
    // parle à Play avec le code traduit (URLs + champ language).
    const appLocale = update.locale;
    const lang = toPlayLanguage(appLocale);
    onProgress?.(appLocale, "start");
    // Labels par bloc, assemblés dans un ordre fixe (les blocs tournent en
    // parallèle → on ne pousse pas dans un tableau partagé).
    const metaLabels: string[] = [];
    const shotLabels: string[] = [];
    const tabletLabels: string[] = [];
    const iconLabels: string[] = [];
    const fgLabels: string[] = [];
    const assemble = (): string[] => [
      ...metaLabels,
      ...shotLabels,
      ...tabletLabels,
      ...iconLabels,
      ...fgLabels,
    ];
    try {
      // Métadonnées d'abord (séquentiel, isolé): évite un PUT de la fiche
      // concurrent avec l'écriture des images de la MÊME locale.
      if (update.metadata) {
        // Merge onto the existing listing so we don't wipe other fields (video…).
        const getRes = await api(
          `${API}/${packageName}/edits/${editId}/listings/${encodeURIComponent(lang)}`,
          { headers },
          { timeoutMs: 30_000, label: `Google Play (${lang}: read listing)` }
        );
        const existing = getRes.ok ? ((await getRes.json()) as Record<string, unknown>) : {};
        const merged: Record<string, unknown> = { ...existing, language: lang };
        if (update.metadata.title) merged.title = update.metadata.title.slice(0, 30);
        const short = update.metadata.subtitle ?? update.metadata.promotionalText;
        if (short) merged.shortDescription = short.slice(0, 80);
        if (update.metadata.description) merged.fullDescription = update.metadata.description.slice(0, 4000);

        const metaChanged =
          existing.title !== merged.title ||
          existing.shortDescription !== merged.shortDescription ||
          existing.fullDescription !== merged.fullDescription;
        if (metaChanged) {
          const putRes = await api(
            `${API}/${packageName}/edits/${editId}/listings/${encodeURIComponent(lang)}`,
            { method: "PUT", headers, body: JSON.stringify(merged) },
            { timeoutMs: 30_000, label: `Google Play (${lang}: write listing)` }
          );
          if (!putRes.ok) {
            throw new Error(`listing ${putRes.status}: ${(await putRes.text()).slice(0, 200)}`);
          }
          if (merged.title) metaLabels.push("title");
          if (merged.shortDescription) metaLabels.push("shortDescription");
          if (merged.fullDescription) metaLabels.push("fullDescription");
        } else {
          metaLabels.push("text (unchanged)");
        }
      }

      // Jeux d'images en parallèle (uploads séquentiels À L'INTÉRIEUR de chaque
      // jeu pour garder l'ordre); bornés globalement par le gate.
      const imageTasks: Array<Promise<void>> = [];

      if (update.screenshots?.length) {
        const shots = update.screenshots;
        imageTasks.push(
          (async () => {
            const { count, changed } = await replaceImages(lang, IMAGE_TYPE, shots);
            shotLabels.push(`${count} screenshots${changed ? "" : " (unchanged)"}`);
          })()
        );
      }

      if (update.screenshotsTablet?.length) {
        const tablet = update.screenshotsTablet;
        imageTasks.push(
          (async () => {
            // Mêmes images pour les deux formats tablette (diff sha256 → pas de
            // ré-upload quand rien ne change).
            const [r7, r10] = await Promise.all([
              replaceImages(lang, IMAGE_TYPE_TABLET_7, tablet),
              replaceImages(lang, IMAGE_TYPE_TABLET_10, tablet),
            ]);
            tabletLabels.push(
              `${r7.count} tablet screenshots 7"${r7.changed ? "" : " (unchanged)"}`,
              `${r10.count} tablet screenshots 10"${r10.changed ? "" : " (unchanged)"}`
            );
          })()
        );
      }

      // Icône: uniquement sur la langue par défaut de la fiche (même règle que le
      // feature graphic). Le diff sha256 évite le ré-upload si elle est déjà en place.
      if (update.icon && isDefaultLocale(lang)) {
        const icon = update.icon;
        imageTasks.push(
          (async () => {
            const { changed } = await replaceImages(lang, IMAGE_TYPE_ICON, [icon]);
            iconLabels.push(changed ? "icon" : "icon (unchanged)");
          })()
        );
      }

      // Feature graphic: uniquement sur la langue par défaut de la fiche.
      if (update.featureGraphic && isDefaultLocale(lang)) {
        const fg = update.featureGraphic;
        imageTasks.push(
          (async () => {
            const { changed } = await replaceImages(lang, IMAGE_TYPE_FEATURE_GRAPHIC, [fg]);
            fgLabels.push(changed ? "feature graphic" : "feature graphic (unchanged)");
          })()
        );
      }

      await Promise.all(imageTasks);

      onProgress?.(appLocale, "done", true);
      return { locale: appLocale, updatedFields: assemble() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      onProgress?.(appLocale, "done", false, msg);
      return { locale: appLocale, updatedFields: assemble(), error: msg };
    }
  }

  const perLocale = await mapWithConcurrency(updates, LOCALE_CONCURRENCY, processLocale);

  // MEASURE (temporaire): si sets_uploaded reste haut sur un republish sans
  // changement, le diff sha256 ne matche pas → tracker les hash côté DB.
  console.log(
    `[publish play] editId=${editId} locales=${updates.length} sets_uploaded=${setsUploaded} sets_skipped=${setsSkipped} batch_ms=${Math.round(
      performance.now() - t0
    )} commit=${Boolean(opts?.commit)}`
  );

  // Commit seulement au dernier lot. Google envoie désormais automatiquement
  // l'edit en review; le paramètre changesNotSentForReview n'est plus accepté
  // et renvoie une INVALID_ARGUMENT (HTTP 400) s'il est présent.
  if (opts?.commit) {
    const commitUrl = `${API}/${packageName}/edits/${editId}:commit`;
    const commitRes = await api(
      commitUrl,
      { method: "POST", headers },
      { timeoutMs: 30_000, label: "Google Play (commit the edit)" }
    );
    if (!commitRes.ok) {
      throw new Error(
        `Google Play (commit ${commitRes.status}) : ${(await commitRes.text()).slice(0, 300)}`
      );
    }
  }

  const okCount = perLocale.filter((r) => r.updatedFields.length > 0 && !r.error).length;
  const message = opts?.commit
    ? `Google Play: ${okCount}/${updates.length} language(s) updated and sent for review.`
    : `Google Play: ${okCount}/${updates.length} language(s) prepared in the edit.`;
  return { store: "playstore", ok: okCount > 0, message, perLocale, editId };
}
