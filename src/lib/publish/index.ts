import { mapWithConcurrency } from "@/lib/concurrency";
import { decryptJSON, encryptJSON } from "@/lib/crypto";
import {
  deleteStoreCredentials as dbDeleteStoreCredentials,
  getStoreCredentials as dbGetStoreCredentials,
  isStoreConnected as dbIsStoreConnected,
  saveStoreCredentials as dbSaveStoreCredentials,
} from "@/lib/db";
import { listFiles, readFile } from "@/lib/storage";
import type { Generation, Listing, Project, StorePlatform } from "@/types";

import { publishAppStoreListings } from "./appstore";
import { fetchBytesWithRetry } from "./http";
import { publishPlayStoreListings } from "./playstore";
import { FULL_SCOPE } from "./scope";
import type {
  AppStoreCredentials,
  ListingMetadata,
  PlayStoreCredentials,
  PublishProgress,
  PublishResult,
  PublishScope,
  StoreCredentials,
  StoreScreenshot,
  StoreUpdate,
} from "./types";

// --- Credentials -----------------------------------------------------------

/**
 * Qui possede une ligne de credentials. La cle App Store Connect est emise par
 * compte developpeur Apple; en mode 100% local et sans notion d'utilisateur,
 * chaque projet stocke ses propres credentials chiffres dans SQLite.
 */
export type CredentialsOwner = { userId: string; projectId: string };

/** Le store est-il connecte pour ce projet ? */
export async function isStoreConnected(
  owner: CredentialsOwner,
  store: StorePlatform
): Promise<boolean> {
  return dbIsStoreConnected(owner.projectId, store);
}

export async function saveStoreCredentials(
  owner: CredentialsOwner,
  store: StorePlatform,
  creds: StoreCredentials
): Promise<void> {
  const encryptedPayload = encryptJSON(creds);
  dbSaveStoreCredentials(owner.projectId, store, encryptedPayload);
}

export async function deleteStoreCredentials(
  owner: CredentialsOwner,
  store: StorePlatform
): Promise<void> {
  dbDeleteStoreCredentials(owner.projectId, store);
}

async function loadStoreCredentials(
  owner: CredentialsOwner,
  store: StorePlatform
): Promise<StoreCredentials> {
  const row = dbGetStoreCredentials(owner.projectId, store);
  if (!row) {
    throw new Error("Store not connected. Connect it first with your API credentials.");
  }
  return decryptJSON<StoreCredentials>(row.encrypted_payload as string);
}

// --- Building updates from generations -------------------------------------

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const APPLE_EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula";
const DESCRIPTION_MAX = 4000;

export function appendLegalLinks(
  description: string | undefined,
  store: StorePlatform,
  privacyUrl: string
): string | undefined {
  if (!description) return description;
  const lines: string[] = [];
  if (privacyUrl && !description.includes(privacyUrl)) {
    lines.push(`Privacy policy : ${privacyUrl}`);
  }
  if (store === "appstore" && !description.includes(APPLE_EULA_URL)) {
    lines.push(`EULA : ${APPLE_EULA_URL}`);
  }
  if (lines.length === 0) return description;
  const suffix = `\n\n${lines.join("\n")}`;
  return description.slice(0, DESCRIPTION_MAX - suffix.length) + suffix;
}

function coerceMetadata(output: unknown): ListingMetadata {
  const o = (output ?? {}) as {
    title?: unknown;
    subtitle?: unknown;
    promotionalText?: unknown;
    description?: unknown;
    keywords?: unknown;
  };
  return {
    title: str(o.title),
    subtitle: str(o.subtitle),
    promotionalText: str(o.promotionalText),
    description: str(o.description),
    keywords: Array.isArray(o.keywords)
      ? o.keywords.filter((k): k is string => typeof k === "string")
      : undefined,
  };
}

function frameFileName(url: string, index: number): string {
  const pathname = url.split("?")[0];
  const ext = /\.jpe?g$/i.test(pathname) ? "jpg" : "png";
  return `screenshot-${index}.${ext}`;
}

function extractLocalPath(url: string): string | null {
  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname.startsWith("/api/files/")) {
      return decodeURIComponent(parsed.pathname.slice("/api/files/".length));
    }
  } catch {
    if (url.startsWith("/api/files/")) {
      return decodeURIComponent(url.slice("/api/files/".length).split("?")[0]);
    }
  }
  return null;
}

async function fetchFrameBuffer(url: string): Promise<Buffer | null> {
  const localPath = extractLocalPath(url);
  if (localPath) {
    try {
      return readFile(localPath);
    } catch {
      return null;
    }
  }
  return fetchBytesWithRetry(url, { timeoutMs: 30_000, label: "Downloading screenshot" });
}

async function downloadFrames(
  output: unknown,
  store: StorePlatform
): Promise<StoreScreenshot[]> {
  const wanted = store === "appstore" ? "ios-6.9" : "android";
  const frames = (output as { frames?: { url?: string; size?: string }[] })?.frames ?? [];
  const matching = frames
    .filter((f) => f.size === wanted && typeof f.url === "string")
    .map((f, i) => ({ url: f.url as string, i }));

  const shots = await mapWithConcurrency(
    matching,
    6,
    async ({ url, i }): Promise<StoreScreenshot | null> => {
      const buffer = await fetchFrameBuffer(url);
      if (!buffer) return null;
      return { buffer, fileName: frameFileName(url, i) };
    }
  );
  return shots.filter((s): s is StoreScreenshot => s !== null);
}

export async function buildUpdateFromGeneration(
  project: Project,
  gen: Generation
): Promise<StoreUpdate> {
  const locale = gen.target_locale ?? project.source_locale;
  if (gen.type === "screenshot") {
    return { locale, screenshots: await downloadFrames(gen.output, project.store) };
  }
  return { locale, metadata: coerceMetadata(gen.output) };
}

export async function buildAllLocaleUpdates(
  project: Project,
  generations: Generation[]
): Promise<StoreUpdate[]> {
  const done = generations
    .filter((g) => g.status === "done" && g.output)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const byLocale = new Map<string, { text?: Generation; shot?: Generation }>();
  for (const g of done) {
    const locale = g.target_locale ?? project.source_locale;
    const entry = byLocale.get(locale) ?? {};
    if ((g.type === "copy" || g.type === "translation") && !entry.text) entry.text = g;
    if (g.type === "screenshot" && !entry.shot) entry.shot = g;
    byLocale.set(locale, entry);
  }

  const updates: StoreUpdate[] = [];
  for (const [locale, entry] of byLocale) {
    const update: StoreUpdate = { locale };
    if (entry.text) update.metadata = coerceMetadata(entry.text.output);
    if (entry.shot) update.screenshots = await downloadFrames(entry.shot.output, project.store);
    if (update.metadata || update.screenshots?.length) updates.push(update);
  }
  return updates;
}

/** Premier fichier d'un dossier local (icone, feature graphic…). */
async function loadLocalFile(
  prefix: string,
  match?: (name: string) => boolean
): Promise<StoreScreenshot | null> {
  const files = listFiles(prefix);
  const file = files.find((f) => (!match || match(f.name)));
  if (!file) return null;
  const buffer = readFile(file.path);
  return { buffer, fileName: file.name };
}

async function loadProjectIcon(project: Project): Promise<StoreScreenshot | null> {
  return loadLocalFile(`${project.id}/icon`);
}

async function loadProjectFeatureGraphic(project: Project): Promise<StoreScreenshot | null> {
  return loadLocalFile(`${project.id}/feature-graphic`, (name) => name.startsWith("current."));
}

async function downloadFrameUrls(value: unknown): Promise<StoreScreenshot[]> {
  const frames = Array.isArray(value) ? (value as { url?: unknown }[]) : [];
  const entries = frames.map((f, i) => ({ url: f?.url, i }));
  const shots = await mapWithConcurrency(
    entries,
    6,
    async ({ url, i }): Promise<StoreScreenshot | null> => {
      if (typeof url !== "string" || !url) return null;
      const buffer = await fetchFrameBuffer(url);
      if (!buffer) return null;
      return { buffer, fileName: frameFileName(url, i + 1) };
    }
  );
  return shots.filter((s): s is StoreScreenshot => s !== null);
}

export async function buildUpdatesFromListings(
  project: Project,
  listings: Listing[],
  scope: PublishScope = FULL_SCOPE
): Promise<StoreUpdate[]> {
  const updates: StoreUpdate[] = [];
  const wantsStoreAssets = scope.storeAssets && project.store === "playstore";
  const icon = wantsStoreAssets ? await loadProjectIcon(project) : null;
  const featureGraphic = wantsStoreAssets ? await loadProjectFeatureGraphic(project) : null;

  const built = await mapWithConcurrency(listings, 6, async (listing) => {
    const update: StoreUpdate = { locale: listing.locale };

    if (scope.text) {
      const keywords = (listing.keywords ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const metadata: ListingMetadata = {
        title: str(listing.title),
        subtitle:
          project.store === "appstore" ? str(listing.subtitle) : str(listing.short_description),
        description: appendLegalLinks(
          str(listing.description),
          project.store,
          (project.privacy_policy_url ?? "").trim()
        ),
        keywords: keywords.length > 0 ? keywords : undefined,
      };
      if (Object.values(metadata).some((v) => v !== undefined)) update.metadata = metadata;
    }

    if (scope.privacyAndWhatsNew && project.store === "appstore") {
      const whatsNew = (listing.whats_new ?? "").trim();
      if (whatsNew) update.metadata = { ...(update.metadata ?? {}), whatsNew };
      const privacyUrl = (project.privacy_policy_url ?? "").trim();
      if (privacyUrl) update.privacyPolicyUrl = privacyUrl;
    }

    if (scope.screenshots) {
      const [shots, tabletShots] = await Promise.all([
        downloadFrameUrls(listing.screenshots),
        downloadFrameUrls(listing.screenshots_tablet),
      ]);
      if (shots.length > 0) update.screenshots = shots;
      if (tabletShots.length > 0) update.screenshotsTablet = tabletShots;
    }

    if (icon) update.icon = icon;
    if (featureGraphic) update.featureGraphic = featureGraphic;

    if (
      update.metadata ||
      update.screenshots ||
      update.screenshotsTablet ||
      update.icon ||
      update.featureGraphic ||
      update.privacyPolicyUrl
    ) {
      return update;
    }
    return null;
  });

  for (const update of built) {
    if (update) updates.push(update);
  }

  return updates;
}

// --- Publish ---------------------------------------------------------------

function describeScope(scope: PublishScope, store: StorePlatform): string {
  const parts: string[] = [];
  if (scope.text) parts.push("listing text");
  if (scope.screenshots) parts.push("screenshots");
  if (scope.storeAssets && store === "playstore") parts.push("icon and feature graphic");
  if (scope.privacyAndWhatsNew && store === "appstore") {
    parts.push("privacy policy and What's New");
  }
  return parts.length > 0 ? parts.join(", ") : "nothing selected";
}

export async function publishListings(
  project: Project,
  updates: StoreUpdate[],
  opts?: {
    commit?: boolean;
    editId?: string;
    changesNotSentForReview?: boolean;
    scope?: PublishScope;
    onProgress?: PublishProgress;
  }
): Promise<PublishResult> {
  if (updates.length === 0) {
    throw new Error(
      `Nothing to publish for the selected content (${describeScope(
        opts?.scope ?? FULL_SCOPE,
        project.store
      )}).`
    );
  }
  const creds = await loadStoreCredentials(
    { userId: project.user_id, projectId: project.id },
    project.store
  );
  if (project.store === "appstore") {
    return publishAppStoreListings(
      creds as AppStoreCredentials,
      project.store_identifier,
      updates,
      { submit: opts?.commit },
      opts?.onProgress
    );
  }
  return publishPlayStoreListings(
    creds as PlayStoreCredentials,
    project.store_identifier,
    updates,
    opts?.onProgress,
    {
      editId: opts?.editId,
      commit: opts?.commit,
      changesNotSentForReview: opts?.changesNotSentForReview,
    }
  );
}
