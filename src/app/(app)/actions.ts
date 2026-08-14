"use server";

import { revalidatePath } from "next/cache";

import { HEX } from "@/lib/ai/generation/screenshot/color-overrides";
import {
  captionUserScreenshots,
  listUserScreenshots,
  loadSourceImages,
  ensureLegalLines,
  MAX_CAPTION_LENGTH,
  pruneLocaleFrames,
  renderLocaleFrames,
  resolveEnglishBase,
  resolveRequestedLocales,
  runLocalePipeline,
  SCREENSHOT_STYLE,
  STORE_LIMITS,
  translateCaptions,
  warmFonts,
  type AppRef,
  type KeywordEntry,
  type ScreenshotDevice,
  type ScreenshotFrame,
  type SourceCaption,
} from "@/lib/aso";
import { translateWhatsNew } from "@/lib/aso/translate";
import { mapWithConcurrency } from "@/lib/concurrency";
import { MAX_FEATURE_LENGTH, MAX_FEATURES } from "@/lib/constants";
import {
  createProject,
  deleteListing as dbDeleteListing,
  deleteProject as dbDeleteProject,
  getListing as dbGetListing,
  getProject as dbGetProject,
  listListings as dbListListings,
  updateProject as dbUpdateProject,
  upsertListing as dbUpsertListing,
} from "@/lib/db";
import { isValidLocale } from "@/lib/locales";
import { resolveLocaleWhatsNew, WHATS_NEW_MAX } from "@/lib/publish/whats-new";
import { parseListing, parseProject } from "@/lib/db/parse";
import { deleteFile, listFiles } from "@/lib/storage";
import type { Project } from "@/types";

export type ProjectActionState = { error?: string; message?: string };

const STORES: Project["store"][] = ["appstore", "playstore"];
const MAX_COMPETITORS = 5;
const MAX_KEYWORDS = 60;
const MAX_KEYWORD_LENGTH = 60;

function sanitizeKeywords(raw: unknown): KeywordEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: KeywordEntry[] = [];
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>;
    const keyword = (typeof r.keyword === "string" ? r.keyword : "").trim().slice(0, MAX_KEYWORD_LENGTH);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      keyword,
      competitors: Number.isFinite(r.competitors) ? Math.max(0, Number(r.competitors)) : 0,
      occurrences: Number.isFinite(r.occurrences) ? Math.max(0, Number(r.occurrences)) : 0,
    });
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

function sanitizeCompetitor(raw: unknown, store: Project["store"]): AppRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const identifier = typeof r.identifier === "string" ? r.identifier.trim() : "";
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!identifier || !name) return null;
  return {
    store,
    identifier,
    name,
    developer: typeof r.developer === "string" ? r.developer : null,
    icon: typeof r.icon === "string" ? r.icon : null,
  };
}

export async function createAsoProject(input: {
  store: Project["store"];
  identifier: string;
  appName: string;
  developerName: string | null;
  iconUrl: string | null;
}): Promise<{ projectId?: string; error?: string }> {
  const store = input.store;
  if (!STORES.includes(store)) return { error: "Invalid platform." };

  const identifier = String(input.identifier ?? "").trim();
  if (!identifier) return { error: "App identifier required." };
  if (
    store === "appstore" &&
    !/^\d+$/.test(identifier) &&
    !/^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)+$/.test(identifier)
  ) {
    return { error: "App Store: numeric App Store ID or bundle ID (com.example.app) expected." };
  }

  const appName = String(input.appName ?? "").trim();
  if (!appName) return { error: "Select your app first." };

  try {
    const { id } = createProject({
      name: appName,
      store,
      store_identifier: identifier,
      app_name: appName,
      developer_name: input.developerName ?? null,
      icon_url: input.iconUrl ?? null,
      competitors: [],
      target_locales: [],
    });
    revalidatePath("/");
    return { projectId: id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create project.";
    if (msg.includes("UNIQUE constraint failed")) {
      return { error: "This app is already in your projects." };
    }
    return { error: msg };
  }
}

export async function updateProjectFeatures(input: {
  projectId: string;
  features: string[];
}): Promise<{ error?: string }> {
  const project = dbGetProject(input.projectId);
  if (!project) return { error: "Project not found." };

  const features = (input.features ?? [])
    .map((f) => String(f ?? "").trim().slice(0, MAX_FEATURE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_FEATURES);

  dbUpdateProject(project.id as string, { features });
  revalidatePath(`/projects/${project.id as string}`);
  return {};
}

export async function updateProjectPrivacyPolicy(input: {
  projectId: string;
  url: string;
}): Promise<{ error?: string }> {
  const project = dbGetProject(input.projectId);
  if (!project) return { error: "Project not found." };

  const url = String(input.url ?? "").trim().slice(0, 500);
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    } catch {
      return { error: "Invalid URL: a full http(s) link is expected." };
    }
  }

  dbUpdateProject(project.id as string, { privacy_policy_url: url });
  revalidatePath(`/projects/${project.id as string}`);
  return {};
}

export async function updateProjectScreenshotColors(input: {
  projectId: string;
  bgColor: string;
  textColor: string;
}): Promise<{ error?: string }> {
  const project = dbGetProject(input.projectId);
  if (!project) return { error: "Project not found." };

  const norm = (v: string) => String(v ?? "").trim().toLowerCase();
  const bg = norm(input.bgColor);
  const text = norm(input.textColor);
  if (bg && !HEX.test(bg)) {
    return { error: "Background color must be a hex value like #1a2b3c." };
  }
  if (text && !HEX.test(text)) {
    return { error: "Headline color must be a hex value like #1a2b3c." };
  }

  dbUpdateProject(project.id as string, { screenshot_bg_color: bg || null, screenshot_text_color: text || null });
  revalidatePath(`/projects/${project.id as string}`);
  return {};
}

export async function updateProjectWhatsNew(input: {
  projectId: string;
  text: string;
}): Promise<{ error?: string }> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const text = String(input.text ?? "").trim().slice(0, 4000);
  dbUpdateProject(project.id, { whats_new: text });

  if (project.store === "appstore") {
    const rows = dbListListings(project.id);
    const locales = rows.map((r) => r.locale as string);
    if (locales.length > 0) {
      await mapWithConcurrency(locales, 6, async (locale) => {
        const value = text
          ? await resolveLocaleWhatsNew(text, project.source_locale, locale, translateWhatsNew)
          : null;
        dbUpsertListing(project.id, locale, { whats_new: value });
      });
    }
  }

  revalidatePath(`/projects/${project.id}`);
  return {};
}

export async function updateProjectLocales(input: {
  projectId: string;
  locales: string[];
}): Promise<{ error?: string }> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const locales = [...new Set((input.locales ?? []).map(String).filter(Boolean))];
  const invalid = locales.filter((l) => !isValidLocale(project.store, l));
  if (invalid.length > 0) {
    return { error: `Unsupported language(s): ${invalid.join(", ")}.` };
  }

  dbUpdateProject(project.id, { target_locales: locales });
  revalidatePath(`/projects/${project.id}`);
  return {};
}

export type AsoGenerationResult = {
  error?: string;
  done: string[];
  failed: { locale: string; error: string }[];
};

const LOCALE_CONCURRENCY = 5;
const SHOT_LOCALE_CONCURRENCY = 2;

export async function generateAso(input: {
  projectId: string;
  locales?: string[];
  keywords?: KeywordEntry[];
  onProgress?: (
    locale: string,
    phase: "start" | "done",
    ok?: boolean,
    error?: string
  ) => void;
}): Promise<AsoGenerationResult> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found.", done: [], failed: [] };

  const competitors = (Array.isArray(project.competitors) ? project.competitors : [])
    .map((c) => sanitizeCompetitor(c, project.store))
    .filter((c): c is AppRef => c !== null);
  if (competitors.length === 0) {
    return { error: "No competitor on this project.", done: [], failed: [] };
  }

  const existingListings = dbListListings(project.id);
  const requested = resolveRequestedLocales(
    input.locales,
    project.target_locales,
    existingListings.map((l) => l.locale as string)
  );
  if (requested.length === 0) {
    return { error: "No target language to generate.", done: [], failed: [] };
  }

  let keywordOverride: KeywordEntry[] | undefined;
  if (input.keywords !== undefined && requested.length === 1) {
    keywordOverride = sanitizeKeywords(input.keywords);
    if (keywordOverride.length === 0) {
      return {
        error: "Add at least one keyword to regenerate with your list.",
        done: [],
        failed: [],
      };
    }
  }

  const app = {
    name: project.app_name ?? project.name,
    developer: project.developer_name,
    features: project.features ?? [],
    privacyPolicyUrl: project.privacy_policy_url ?? "",
  };

  let englishBase: KeywordEntry[] = [];
  if (!keywordOverride) {
    const { base, key, recomputed } = await resolveEnglishBase(
      project.store,
      competitors,
      (Array.isArray(project.competitor_keywords_en)
        ? project.competitor_keywords_en
        : []) as unknown as KeywordEntry[],
      project.competitor_keywords_key
    );
    englishBase = base;
    if (recomputed && base.length > 0) {
      dbUpdateProject(project.id, {
        competitor_keywords_en: base,
        competitor_keywords_key: key,
      });
    }
  }

  console.log(
    `[measure aso] start epoch=${Date.now()} locales=${requested.length} concurrency=${LOCALE_CONCURRENCY}`
  );
  const asoStart = performance.now();
  const outcomes = await mapWithConcurrency(requested, LOCALE_CONCURRENCY, async (locale) => {
    input.onProgress?.(locale, "start");
    try {
      const t0 = performance.now();
      const result = await runLocalePipeline(
        project.store,
        app,
        competitors,
        locale,
        englishBase,
        keywordOverride
      );
      console.log(`[measure aso] locale=${locale} pipeline=${Math.round(performance.now() - t0)}ms`);
      const listing = parseListing(dbGetListing(project.id, locale) ?? {});
      dbUpsertListing(project.id, locale, {
        title: result.listing.title,
        subtitle: result.listing.subtitle,
        short_description: result.listing.shortDescription,
        description: ensureLegalLines(
          result.listing.description,
          project.store,
          app.privacyPolicyUrl
        ),
        keywords: result.listing.keywords,
        keyword_base: result.keywordBase,
      });

      const whatsNewSource = (project.whats_new ?? "").trim();
      if (project.store === "appstore" && whatsNewSource && listing.whats_new == null) {
        try {
          const value = await resolveLocaleWhatsNew(
            whatsNewSource,
            project.source_locale,
            locale,
            translateWhatsNew
          );
          dbUpsertListing(project.id, locale, { whats_new: value });
        } catch {
          // Note non remplie: sans consequence sur la fiche generee.
        }
      }
      input.onProgress?.(locale, "done", true);
      return { locale, ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error.";
      input.onProgress?.(locale, "done", false, msg);
      return { locale, ok: false as const, error: msg };
    }
  });

  const done = outcomes.filter((o) => o.ok).map((o) => o.locale);
  const failed = outcomes.flatMap((o) => (o.ok ? [] : [{ locale: o.locale, error: o.error }]));

  console.log(
    `[measure aso] end epoch=${Date.now()} total=${Math.round(performance.now() - asoStart)}ms done=${done.length} failed=${failed.length}`
  );
  revalidatePath(`/projects/${project.id}`);
  return { done, failed };
}

export async function saveListing(input: {
  projectId: string;
  locale: string;
  title: string;
  subtitle: string;
  shortDescription: string;
  description: string;
  keywords: string;
  keywordBase?: KeywordEntry[];
  whatsNew?: string;
}): Promise<{ error?: string }> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const trim = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const keywordBase =
    input.keywordBase !== undefined ? sanitizeKeywords(input.keywordBase) : undefined;

  dbUpsertListing(project.id, String(input.locale ?? "").trim(), {
    title: trim(input.title, STORE_LIMITS.title),
    subtitle: trim(input.subtitle, STORE_LIMITS.subtitle),
    short_description: trim(input.shortDescription, STORE_LIMITS.shortDescription),
    description: trim(input.description, STORE_LIMITS.description),
    keywords: trim(input.keywords, STORE_LIMITS.keywords),
    ...(keywordBase !== undefined ? { keyword_base: keywordBase } : {}),
    ...(input.whatsNew !== undefined
      ? { whats_new: trim(input.whatsNew, WHATS_NEW_MAX) }
      : {}),
  });

  revalidatePath(`/projects/${project.id}`);
  return {};
}

export async function deleteListing(input: {
  projectId: string;
  locale: string;
}): Promise<{ error?: string }> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const locale = String(input.locale ?? "").trim();
  if (!locale) return { error: "Locale required." };

  dbDeleteListing(project.id, locale);

  for (const device of ["phone", "tablet"] as const) {
    const prefix =
      device === "tablet"
        ? `${project.id}/aso/${locale}/tablet`
        : `${project.id}/aso/${locale}`;
    try {
      const files = listFiles(prefix);
      for (const f of files) deleteFile(f.path);
    } catch {
      // Fichiers orphelins toleres.
    }
  }

  revalidatePath(`/projects/${project.id}`);
  return {};
}

export async function updateProjectCompetitors(input: {
  projectId: string;
  competitors: unknown[];
}): Promise<{ error?: string }> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const competitors = (input.competitors ?? [])
    .map((c) => sanitizeCompetitor(c, project.store))
    .filter((c): c is AppRef => c !== null)
    .filter((c) => c.identifier !== project.store_identifier)
    .slice(0, MAX_COMPETITORS);
  if (competitors.length < 1) {
    return { error: "Keep at least one competitor." };
  }

  dbUpdateProject(project.id, { competitors });
  revalidatePath(`/projects/${project.id}`);
  return {};
}

export type ScreenshotGenerationResult = {
  error?: string;
  done: string[];
  failed: { locale: string; error: string }[];
};

async function resolveDeviceCaptions(
  project: Project,
  device: ScreenshotDevice,
  sources: { path: string; dataUrl: string }[]
): Promise<Map<string, string>> {
  const storedRaw =
    device === "tablet" ? project.screenshot_captions_tablet : project.screenshot_captions;
  const stored = (Array.isArray(storedRaw) ? storedRaw : []) as unknown as SourceCaption[];
  const byPath = new Map(stored.map((c) => [c.path, c.caption]));
  if (sources.length > 0 && sources.every((s) => byPath.get(s.path))) return byPath;

  const tVision = performance.now();
  const sourceCaptions = await captionUserScreenshots(
    project.app_name ?? project.name,
    project.source_locale,
    sources
  );
  console.log(
    `[measure vision] device=${device} images=${sources.length} ${Math.round(performance.now() - tVision)}ms epoch=${Date.now()}`
  );
  dbUpdateProject(
    project.id,
    device === "tablet"
      ? { screenshot_captions_tablet: sourceCaptions }
      : { screenshot_captions: sourceCaptions }
  );
  return new Map(sourceCaptions.map((c) => [c.path, c.caption]));
}

export async function prepareScreenshotCaptions(input: {
  projectId: string;
}): Promise<{ error?: string; analyzed?: boolean }> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const paths = await listUserScreenshots(project);
  if (paths.length === 0) {
    return { error: "No screenshot uploaded on this project. Add them first." };
  }
  const tabletPaths = await listUserScreenshots(project, "tablet");

  const covers = (device: ScreenshotDevice, ps: string[]): boolean => {
    if (ps.length === 0) return true;
    const raw =
      device === "tablet" ? project.screenshot_captions_tablet : project.screenshot_captions;
    const stored = (Array.isArray(raw) ? raw : []) as unknown as SourceCaption[];
    const byPath = new Map(stored.map((c) => [c.path, c.caption]));
    return ps.every((p) => Boolean(byPath.get(p)));
  };

  if (covers("phone", paths) && covers("tablet", tabletPaths)) return { analyzed: false };

  try {
    if (!covers("phone", paths)) {
      await resolveDeviceCaptions(project, "phone", await loadSourceImages(paths));
    }
    if (tabletPaths.length > 0 && !covers("tablet", tabletPaths)) {
      await resolveDeviceCaptions(project, "tablet", await loadSourceImages(tabletPaths));
    }
    return { analyzed: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Caption pass failed." };
  }
}

export async function generateProjectScreenshots(input: {
  projectId: string;
  locales?: string[];
  onProgress?: (
    locale: string,
    phase: "start" | "done",
    ok?: boolean,
    error?: string
  ) => void;
}): Promise<ScreenshotGenerationResult> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found.", done: [], failed: [] };

  const paths = await listUserScreenshots(project);
  if (paths.length === 0) {
    return {
      error: "No screenshot uploaded on this project. Add them first.",
      done: [],
      failed: [],
    };
  }
  const tabletPaths = await listUserScreenshots(project, "tablet");

  try {
    const sources = await loadSourceImages(paths);
    const captionByPath = await resolveDeviceCaptions(project, "phone", sources);
    const tabletSources = tabletPaths.length > 0 ? await loadSourceImages(tabletPaths) : [];
    const tabletCaptionByPath =
      tabletSources.length > 0
        ? await resolveDeviceCaptions(project, "tablet", tabletSources)
        : new Map<string, string>();

    const allLocales = project.target_locales.length
      ? project.target_locales
      : [project.source_locale];
    const existingListings = dbListListings(project.id);
    const locales = resolveRequestedLocales(
      input.locales,
      allLocales,
      existingListings.map((l) => l.locale as string)
    );
    if (locales.length === 0) {
      return { error: "No target language to process.", done: [], failed: [] };
    }

    console.log(
      `[measure shots] start epoch=${Date.now()} locales=${locales.length} concurrency=${SHOT_LOCALE_CONCURRENCY}`
    );
    await warmFonts(locales);
    const shotsStart = performance.now();
    const outcomes = await mapWithConcurrency(locales, SHOT_LOCALE_CONCURRENCY, async (locale) => {
      input.onProgress?.(locale, "start");
      try {
        const t0 = performance.now();
        const base = sources.map((s) => captionByPath.get(s.path) ?? "");
        const translated = await translateCaptions(base, project.source_locale, locale);
        const translateMs = Math.round(performance.now() - t0);
        const entries = sources.map((s, i) => ({ ...s, caption: translated[i] }));
        const t1 = performance.now();
        const frames = await renderLocaleFrames(project, locale, entries, SCREENSHOT_STYLE);
        const renderMs = Math.round(performance.now() - t1);

        let tabletFrames: ScreenshotFrame[] = [];
        let tabletTranslateMs = 0;
        let tabletRenderMs = 0;
        if (tabletSources.length > 0) {
          const t2 = performance.now();
          const tabletBase = tabletSources.map((s) => tabletCaptionByPath.get(s.path) ?? "");
          const tabletTranslated = await translateCaptions(
            tabletBase,
            project.source_locale,
            locale
          );
          tabletTranslateMs = Math.round(performance.now() - t2);
          const tabletEntries = tabletSources.map((s, i) => ({
            ...s,
            caption: tabletTranslated[i],
          }));
          const t3 = performance.now();
          tabletFrames = await renderLocaleFrames(
            project,
            locale,
            tabletEntries,
            SCREENSHOT_STYLE,
            "tablet"
          );
          tabletRenderMs = Math.round(performance.now() - t3);
        }
        console.log(
          `[measure shots] locale=${locale} phone(translate=${translateMs}ms frames=${frames.length} render+upload=${renderMs}ms) tablet(translate=${tabletTranslateMs}ms frames=${tabletFrames.length} render+upload=${tabletRenderMs}ms)`
        );

        dbUpsertListing(project.id, locale, {
          screenshots: frames,
          screenshots_tablet: tabletFrames,
        });

        await pruneLocaleFrames(project, locale, {
          phone: frames.length,
          tablet: tabletFrames.length,
        });

        input.onProgress?.(locale, "done", true);
        return { locale, ok: true as const };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error.";
        console.error(`[measure shots] locale=${locale} FAILED: ${msg}`);
        input.onProgress?.(locale, "done", false, msg);
        return { locale, ok: false as const, error: msg };
      }
    });

    const done = outcomes.filter((o) => o.ok).map((o) => o.locale);
    const failed = outcomes.flatMap((o) => (o.ok ? [] : [{ locale: o.locale, error: o.error }]));

    console.log(
      `[measure shots] end epoch=${Date.now()} total=${Math.round(performance.now() - shotsStart)}ms done=${done.length} failed=${failed.length}`
    );
    revalidatePath(`/projects/${project.id}`);
    return { done, failed };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Screenshot generation failed.",
      done: [],
      failed: [],
    };
  }
}

export async function saveScreenshotCaptions(input: {
  projectId: string;
  locale: string;
  captions: { sourcePath: string; caption: string }[];
  device?: ScreenshotDevice;
}): Promise<{ error?: string }> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const device: ScreenshotDevice = input.device === "tablet" ? "tablet" : "phone";
  const storedRaw =
    device === "tablet" ? project.screenshot_captions_tablet : project.screenshot_captions;
  const stored = (Array.isArray(storedRaw) ? storedRaw : []) as unknown as SourceCaption[];
  const paths = stored.map((c) => c.path);
  if (paths.length === 0) return { error: "No known source screenshot." };

  const captionBySource = new Map(
    input.captions.map((c) => [
      String(c.sourcePath),
      String(c.caption ?? "").trim().slice(0, MAX_CAPTION_LENGTH),
    ])
  );

  try {
    const sources = await loadSourceImages(paths);
    const entries = sources.map((s) => ({
      ...s,
      caption:
        captionBySource.get(s.path) ||
        stored.find((c) => c.path === s.path)?.caption ||
        "",
    }));
    const frames = await renderLocaleFrames(
      project,
      input.locale,
      entries,
      SCREENSHOT_STYLE,
      device
    );

    dbUpsertListing(project.id, String(input.locale), {
      ...(device === "tablet" ? { screenshots_tablet: frames } : { screenshots: frames }),
    });

    revalidatePath(`/projects/${project.id}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Re-render failed." };
  }
}

export async function deleteScreenshots(input: {
  projectId: string;
  locale: string;
  device?: ScreenshotDevice;
}): Promise<{ error?: string }> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const locale = String(input.locale ?? "").trim();
  if (!locale) return { error: "Locale required." };
  const device: ScreenshotDevice = input.device === "tablet" ? "tablet" : "phone";

  dbUpsertListing(project.id, locale, {
    ...(device === "tablet" ? { screenshots_tablet: [] } : { screenshots: [] }),
  });

  const prefix =
    device === "tablet"
      ? `${project.id}/aso/${locale}/tablet`
      : `${project.id}/aso/${locale}`;
  try {
    const files = listFiles(prefix);
    for (const f of files) deleteFile(f.path);
  } catch {
    // Fichiers orphelins toleres.
  }

  revalidatePath(`/projects/${project.id}`);
  return {};
}

export async function reorderScreenshots(input: {
  projectId: string;
  device?: ScreenshotDevice;
  order: string[];
}): Promise<{ error?: string }> {
  const device: ScreenshotDevice = input.device === "tablet" ? "tablet" : "phone";
  const order = input.order.map(String);
  if (order.length === 0) return {};
  const rank = new Map(order.map((p, i) => [p, i]));

  function reorderByKey<T>(arr: T[], key: (t: T) => string): T[] {
    return arr
      .map((v, i) => ({ v, i }))
      .sort((a, b) => {
        const ra = rank.get(key(a.v));
        const rb = rank.get(key(b.v));
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return a.i - b.i;
      })
      .map((x) => x.v);
  }

  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const captionsRaw =
    device === "tablet" ? project.screenshot_captions_tablet : project.screenshot_captions;
  const captions = Array.isArray(captionsRaw)
    ? (captionsRaw as unknown as SourceCaption[])
    : [];
  const byPath = new Map(captions.map((c) => [c.path, c]));
  const orderedCaptions: SourceCaption[] = [
    ...order.map((p) => byPath.get(p) ?? { path: p, caption: "" }),
    ...captions.filter((c) => !rank.has(c.path)),
  ];
  dbUpdateProject(
    project.id,
    device === "tablet"
      ? { screenshot_captions_tablet: orderedCaptions }
      : { screenshot_captions: orderedCaptions }
  );

  const listings = dbListListings(project.id);
  for (const listingRow of listings) {
    const listing = parseListing(listingRow);
    const framesRaw = device === "tablet" ? listing.screenshots_tablet : listing.screenshots;
    const frames = Array.isArray(framesRaw)
      ? (framesRaw as unknown as ScreenshotFrame[])
      : [];
    if (frames.length === 0) continue;
    const reordered = reorderByKey(frames, (f) => f.sourcePath);
    if (reordered.every((f, i) => f === frames[i])) continue;
    dbUpsertListing(project.id, listing.locale, {
      ...(device === "tablet"
        ? { screenshots_tablet: reordered }
        : { screenshots: reordered }),
    });
  }

  return {};
}

export async function deleteProject(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  dbDeleteProject(id);
  revalidatePath("/");
}
