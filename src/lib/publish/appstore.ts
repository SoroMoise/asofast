import crypto from "node:crypto";

import jwt from "jsonwebtoken";

import { fetchWithTimeout } from "./http";
import type {
  AppStoreCredentials,
  LocaleResult,
  PublishProgress,
  PublishResult,
  StoreScreenshot,
  StoreUpdate,
} from "./types";

const ASC_BASE = "https://api.appstoreconnect.apple.com";
// Frames iOS générées en 1290x2796 = grand iPhone (6.9"/6.7", même résolution).
// Dans l'API ASC ce display type s'appelle APP_IPHONE_67; APP_IPHONE_69 n'existe
// pas dans l'enum screenshotDisplayType (→ 409 ENTITY_ERROR.ATTRIBUTE.TYPE).
const DISPLAY_TYPE = "APP_IPHONE_67";
// Generated iPad frames are 2048x2732 -> iPad Pro 12.9"/13" display.
const DISPLAY_TYPE_IPAD = "APP_IPAD_PRO_3GEN_129";

// App Store version states whose localizations/screenshots are editable.
const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

type AscResource = { id: string; attributes?: Record<string, unknown> };
type AscList = { data?: AscResource[] };
type AscSingle = { data?: AscResource };
type UploadOperation = {
  method?: string;
  url?: string;
  length?: number;
  offset?: number;
  requestHeaders?: { name?: string; value?: string }[];
};

function ascToken(creds: AppStoreCredentials): string {
  return jwt.sign({}, creds.privateKey, {
    algorithm: "ES256",
    keyid: creds.keyId,
    issuer: creds.issuerId,
    audience: "appstoreconnect-v1",
    expiresIn: "19m",
  });
}

async function asc<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(
    `${ASC_BASE}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    },
    { timeoutMs: 30_000, label: `App Store Connect (${init?.method ?? "GET"} ${path.split("?")[0]})` }
  );
  if (!res.ok) {
    throw new Error(`App Store Connect ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

function pickByLocale(list: AscResource[], locale: string): AscResource | undefined {
  const exact = list.find((r) => r.attributes?.locale === locale);
  if (exact) return exact;
  const lang = locale.split("-")[0].toLowerCase();
  return list.find(
    (r) => String(r.attributes?.locale ?? "").split("-")[0].toLowerCase() === lang
  );
}

/**
 * Sélectionne l'appInfo ÉDITABLE (celui de la version en préparation) parmi les
 * appInfos d'une app. Une app en ligne avec une mise à jour en cours expose DEUX
 * appInfos: le live (READY_FOR_SALE, name/subtitle verrouillés + jeu de langues
 * figé) et le brouillon éditable qui porte toutes les langues cibles. L'API ne
 * garantit pas l'ordre, donc prendre data[0] pouvait viser le live: les langues
 * absentes de ce jeu figé étaient ignorées et restaient dans la langue par
 * défaut. On cible d'abord un état éditable, sinon tout appInfo non-live, sinon
 * le premier (app à appInfo unique: comportement inchangé).
 */
export function selectEditableAppInfo(list: AscResource[]): AscResource | undefined {
  const editable = list.find((ai) =>
    EDITABLE_STATES.has(String(ai.attributes?.appStoreState ?? ""))
  );
  if (editable) return editable;
  const notLive = list.find(
    (ai) => String(ai.attributes?.appStoreState ?? "") !== "READY_FOR_SALE"
  );
  return notLive ?? list[0];
}

async function getOrCreateScreenshotSet(
  token: string,
  versionLocId: string,
  displayType: string
): Promise<string> {
  const sets = await asc<AscList>(
    token,
    `/v1/appStoreVersionLocalizations/${versionLocId}/appScreenshotSets?limit=50`
  );
  const existing = sets.data?.find(
    (s) => s.attributes?.screenshotDisplayType === displayType
  );
  if (existing) return existing.id;

  const created = await asc<AscSingle>(token, `/v1/appScreenshotSets`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: displayType },
        relationships: {
          appStoreVersionLocalization: {
            data: { type: "appStoreVersionLocalizations", id: versionLocId },
          },
        },
      },
    }),
  });
  if (!created.data) throw new Error("Failed to create screenshot set.");
  return created.data.id;
}

/** Remplace tous les screenshots d'un display type pour une localisation. */
async function replaceScreenshotSet(
  token: string,
  versionLocId: string,
  displayType: string,
  shots: StoreScreenshot[]
): Promise<void> {
  const setId = await getOrCreateScreenshotSet(token, versionLocId, displayType);
  await clearScreenshotSet(token, setId);
  for (const shot of shots) {
    await uploadScreenshot(token, setId, shot);
  }
}

async function clearScreenshotSet(token: string, setId: string): Promise<void> {
  const shots = await asc<AscList>(
    token,
    `/v1/appScreenshotSets/${setId}/appScreenshots?limit=50`
  );
  for (const shot of shots.data ?? []) {
    await asc(token, `/v1/appScreenshots/${shot.id}`, { method: "DELETE" });
  }
}

async function uploadScreenshot(
  token: string,
  setId: string,
  shot: StoreScreenshot
): Promise<void> {
  const reservation = await asc<{
    data?: { id: string; attributes?: { uploadOperations?: UploadOperation[] } };
  }>(token, `/v1/appScreenshots`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appScreenshots",
        attributes: { fileName: shot.fileName, fileSize: shot.buffer.length },
        relationships: {
          appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } },
        },
      },
    }),
  });

  const shotId = reservation.data?.id;
  if (!shotId) throw new Error("Screenshot reservation failed.");

  for (const op of reservation.data?.attributes?.uploadOperations ?? []) {
    if (!op.url || op.offset == null || op.length == null) continue;
    const headers: Record<string, string> = {};
    for (const h of op.requestHeaders ?? []) {
      if (h.name && h.value != null) headers[h.name] = h.value;
    }
    const res = await fetchWithTimeout(
      op.url,
      {
        method: op.method ?? "PUT",
        headers,
        body: new Uint8Array(shot.buffer.subarray(op.offset, op.offset + op.length)),
      },
      { timeoutMs: 60_000, label: "App Store (upload screenshot)" }
    );
    if (!res.ok) throw new Error(`Screenshot upload (chunk ${res.status}).`);
  }

  const checksum = crypto.createHash("md5").update(shot.buffer).digest("hex");
  await asc(token, `/v1/appScreenshots/${shotId}`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "appScreenshots",
        id: shotId,
        attributes: { uploaded: true, sourceFileChecksum: checksum },
      },
    }),
  });
}

/**
 * Soumet la version éditable en review Apple via le flux reviewSubmissions
 * (création de la soumission, ajout de la version, envoi).
 */
async function submitVersionForReview(
  token: string,
  appId: string,
  versionId: string
): Promise<void> {
  const submission = await asc<AscSingle>(token, `/v1/reviewSubmissions`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    }),
  });
  const submissionId = submission.data?.id;
  if (!submissionId) throw new Error("Failed to create submission.");

  await asc(token, `/v1/reviewSubmissionItems`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: submissionId } },
          appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
        },
      },
    }),
  });

  await asc(token, `/v1/reviewSubmissions/${submissionId}`, {
    method: "PATCH",
    body: JSON.stringify({
      data: { type: "reviewSubmissions", id: submissionId, attributes: { submitted: true } },
    }),
  });
}

/**
 * Update App Store listing metadata + screenshots for one or more locales.
 * Requires an editable app version to exist. Par défaut n'édite que le
 * brouillon; opts.submit soumet la version en review Apple après les mises à
 * jour (nécessite un build attaché à la version).
 */
export async function publishAppStoreListings(
  creds: AppStoreCredentials,
  appIdentifier: string,
  updates: StoreUpdate[],
  opts?: { submit?: boolean },
  onProgress?: PublishProgress
): Promise<PublishResult> {
  const token = ascToken(creds);

  // store_identifier peut être l'App Store ID numérique (= id de la ressource app
  // ASC → fetch direct) OU un bundle ID (com.x.y → filtre documenté). L'ASC voit
  // les apps non publiées, donc les deux marchent avant la mise en ligne.
  let app: AscResource | undefined;
  if (/^\d+$/.test(appIdentifier)) {
    try {
      app = (await asc<AscSingle>(token, `/v1/apps/${appIdentifier}`)).data;
    } catch {
      app = undefined;
    }
  } else {
    const apps = await asc<AscList>(
      token,
      `/v1/apps?filter[bundleId]=${encodeURIComponent(appIdentifier)}&limit=1`
    );
    app = apps.data?.[0];
  }
  if (!app) {
    throw new Error(
      `App not found on App Store Connect: ${appIdentifier}. Check the App Store ID / bundle ID and that the API key has access to this app.`
    );
  }

  const versions = await asc<AscList>(token, `/v1/apps/${app.id}/appStoreVersions?limit=10`);
  const version = versions.data?.find((v) =>
    EDITABLE_STATES.has(String(v.attributes?.appStoreState ?? ""))
  );
  if (!version) {
    throw new Error(
      "No editable version on App Store Connect. Create a version in preparation first (without submitting it)."
    );
  }

  const versionLocs = await asc<AscList>(
    token,
    `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`
  );
  const appInfos = await asc<AscList>(token, `/v1/apps/${app.id}/appInfos?limit=10`);
  const appInfo = selectEditableAppInfo(appInfos.data ?? []);
  const infoLocs = appInfo
    ? await asc<AscList>(token, `/v1/appInfos/${appInfo.id}/appInfoLocalizations?limit=50`)
    : { data: [] };

  const perLocale: LocaleResult[] = [];
  for (const update of updates) {
    const fields: string[] = [];
    onProgress?.(update.locale, "start");
    // name/subtitle (App Information) échouent dans leur propre bloc: on retient
    // l'erreur réelle ASC pour la remonter par langue au lieu de la masquer.
    let infoError: string | undefined;
    try {
      const versionLoc = pickByLocale(versionLocs.data ?? [], update.locale);

      if (update.metadata && versionLoc) {
        const attrs: Record<string, string> = {};
        if (update.metadata.description) attrs.description = update.metadata.description.slice(0, 4000);
        if (update.metadata.keywords?.length) attrs.keywords = update.metadata.keywords.join(",").slice(0, 100);
        if (update.metadata.promotionalText) attrs.promotionalText = update.metadata.promotionalText.slice(0, 170);
        if (Object.keys(attrs).length > 0) {
          await asc(token, `/v1/appStoreVersionLocalizations/${versionLoc.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              data: { type: "appStoreVersionLocalizations", id: versionLoc.id, attributes: attrs },
            }),
          });
          fields.push(...Object.keys(attrs));
        }
      }

      // whatsNew dans son PROPRE PATCH: il n'est valide que sur une version
      // update; sur la 1re version Apple le rejette. Isolé pour qu'un rejet ne
      // fasse pas tomber description/keywords du PATCH précédent.
      if (update.metadata?.whatsNew && versionLoc) {
        try {
          await asc(token, `/v1/appStoreVersionLocalizations/${versionLoc.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              data: {
                type: "appStoreVersionLocalizations",
                id: versionLoc.id,
                attributes: { whatsNew: update.metadata.whatsNew.slice(0, 4000) },
              },
            }),
          });
          fields.push("whatsNew");
        } catch {
          // Version sans "What's New" (1re version): on garde les autres champs.
        }
      }

      // App Information: name/sous-titre et URL de politique de confidentialité
      // vivent sur la MÊME ressource (appInfoLocalizations), mais relèvent de
      // deux cases distinctes côté UI: on résout la localisation une fois et on
      // patche chaque bloc à part.
      const wantsName = Boolean(update.metadata?.title || update.metadata?.subtitle);
      const wantsPrivacy = Boolean(update.privacyPolicyUrl);
      if (wantsName || wantsPrivacy) {
        const infoLoc = pickByLocale(infoLocs.data ?? [], update.locale);
        if (!infoLoc) {
          infoError = "No App Information localization for this locale on the editable app version.";
        } else {
          if (wantsName) {
            const attrs: Record<string, string> = {};
            if (update.metadata?.title) attrs.name = update.metadata.title.slice(0, 30);
            if (update.metadata?.subtitle) attrs.subtitle = update.metadata.subtitle.slice(0, 30);
            try {
              await asc(token, `/v1/appInfoLocalizations/${infoLoc.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  data: { type: "appInfoLocalizations", id: infoLoc.id, attributes: attrs },
                }),
              });
              fields.push(...Object.keys(attrs));
            } catch (e) {
              // Rejet ASC (nom déjà pris sur le store, état non éditable…): remonté
              // par langue au lieu d'être avalé -> le nom/sous-titre "toujours en
              // anglais" devient un échec visible et diagnosticable.
              infoError = e instanceof Error ? e.message : "name/subtitle update failed";
            }
          }

          // privacyPolicyUrl dans son PROPRE PATCH: une URL refusée par Apple ne
          // doit pas emporter name/subtitle avec elle (même isolement que
          // whatsNew). L'échec est retenu, jamais avalé.
          if (wantsPrivacy) {
            try {
              await asc(token, `/v1/appInfoLocalizations/${infoLoc.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  data: {
                    type: "appInfoLocalizations",
                    id: infoLoc.id,
                    attributes: { privacyPolicyUrl: update.privacyPolicyUrl },
                  },
                }),
              });
              fields.push("privacyPolicyUrl");
            } catch (e) {
              infoError ??=
                e instanceof Error ? e.message : "privacy policy URL update failed";
            }
          }
        }
      }

      if (update.screenshots?.length && versionLoc) {
        await replaceScreenshotSet(token, versionLoc.id, DISPLAY_TYPE, update.screenshots);
        fields.push(`${update.screenshots.length} screenshots`);
      }

      if (update.screenshotsTablet?.length && versionLoc) {
        await replaceScreenshotSet(
          token,
          versionLoc.id,
          DISPLAY_TYPE_IPAD,
          update.screenshotsTablet
        );
        fields.push(`${update.screenshotsTablet.length} iPad screenshots`);
      }

      if (fields.length === 0) {
        const err = infoError ?? "Locale not found on the listing.";
        perLocale.push({ locale: update.locale, updatedFields: [], error: err });
        onProgress?.(update.locale, "done", false, err);
      } else if (infoError) {
        // Autres champs poussés mais name/subtitle refusé: langue marquée en
        // erreur (rouge + raison) pour que l'utilisateur voie que le nom/sous-
        // titre n'a pas été appliqué, au lieu d'un faux succès.
        perLocale.push({ locale: update.locale, updatedFields: fields, error: infoError });
        onProgress?.(update.locale, "done", false, infoError);
      } else {
        perLocale.push({ locale: update.locale, updatedFields: fields });
        onProgress?.(update.locale, "done", true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      perLocale.push({ locale: update.locale, updatedFields: fields, error: msg });
      onProgress?.(update.locale, "done", false, msg);
    }
  }

  const okCount = perLocale.filter((r) => r.updatedFields.length > 0).length;

  let message = `App Store: ${okCount}/${updates.length} language(s) updated (draft, not submitted).`;
  if (opts?.submit && okCount > 0) {
    try {
      await submitVersionForReview(token, app.id, version.id);
      message = `App Store: ${okCount}/${updates.length} language(s) updated, version submitted for Apple review.`;
    } catch (e) {
      message = `App Store: ${okCount}/${updates.length} language(s) updated, but submission failed: ${
        e instanceof Error ? e.message : "error"
      }`;
    }
  }

  return {
    store: "appstore",
    ok: okCount > 0,
    message,
    perLocale,
  };
}
