import { warmFonts } from "@/lib/aso";
import {
  DEFAULT_FEATURE_GRAPHIC_TEMPLATE,
  findFeatureGraphicArt,
  hasLocaleFeatureGraphic,
  loadFeatureGraphicContext,
  localeFeatureGraphicPaths,
  localeFeatureGraphicStatus,
  readFeatureGraphicTemplate,
  readLocaleFeatureGraphic,
  renderFeatureGraphic,
  resolveLocaleFeatureGraphicTexts,
  sanitizeFeatureGraphicTemplate,
  sanitizeFeatureGraphicTexts,
  saveFeatureGraphicTemplate,
  saveLocaleFeatureGraphic,
  type LocaleFeatureGraphic,
} from "@/lib/aso/feature-graphic";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getProject as dbGetProject, listListings as dbListListings } from "@/lib/db";
import { parseListing, parseProject } from "@/lib/db/parse";
import type { Project } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 800;

// Traductions (réseau) en parallèle; le rendu satori, lui, reste séquentiel.
const TRANSLATE_CONCURRENCY = 4;

type Params = { params: Promise<{ projectId: string }> };

function loadProject(projectId: string): Project | null {
  const project = parseProject(dbGetProject(projectId) ?? {});
  return project.id ? project : null;
}

function projectLocales(project: Project): string[] {
  return project.target_locales.length > 0 ? project.target_locales : [project.source_locale];
}

function listingTitles(projectId: string): Map<string, string> {
  return new Map(
    dbListListings(projectId).map((row) => {
      const listing = parseListing(row);
      return [String(listing.locale), String(listing.title ?? "")] as const;
    })
  );
}

/**
 * GET /api/projects/{id}/feature-graphics
 * État de la bannière localisée: modèle (ou défaut), illustration, et pour
 * chaque langue cible l'URL de la bannière rendue, ses textes, si ces textes
 * ont été édités à la main et si la bannière est périmée (null si absente).
 */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const project = loadProject(projectId);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

  const template = readFeatureGraphicTemplate(project.id);
  const art = findFeatureGraphicArt(project.id);
  const ctx = template && art ? loadFeatureGraphicContext(project.id) : null;
  const titles = listingTitles(project.id);
  const stamp = Date.now();
  const locales = projectLocales(project).map((locale) => {
    const status = ctx
      ? localeFeatureGraphicStatus(ctx, locale, titles.get(locale) ?? null)
      : {
          exists: hasLocaleFeatureGraphic(project.id, locale),
          stale: false,
          stored: readLocaleFeatureGraphic(project.id, locale),
        };
    return {
      locale,
      url: status.exists
        ? `/api/files/${localeFeatureGraphicPaths(project.id, locale).image}?v=${stamp}`
        : null,
      texts: status.stored
        ? { headline: status.stored.headline, badges: status.stored.badges }
        : null,
      manual: status.stored?.manual ?? false,
      stale: status.stale,
    };
  });
  return Response.json({
    configured: template !== null,
    template: template ?? DEFAULT_FEATURE_GRAPHIC_TEMPLATE,
    art: art ? `/api/files/${art}?v=${stamp}` : null,
    sourceLocale: project.source_locale,
    locales,
  });
}

/** PUT /api/projects/{id}/feature-graphics  body: template → enregistre le modèle. */
export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const project = loadProject(projectId);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid template." }, { status: 400 });
  }
  return Response.json({ template: saveFeatureGraphicTemplate(project.id, body) });
}

/**
 * POST /api/projects/{id}/feature-graphics
 * body: { locales?: string[], onlyMissing?: boolean, texts?: { headline, badges },
 *         resetManual?: boolean }
 * Rend les bannières des langues demandées (défaut: toutes les langues cibles).
 * `texts` = édition manuelle, accepté pour UNE seule langue (aucune traduction).
 * Des textes déjà édités à la main sont conservés, sauf `resetManual: true`.
 * Traductions en parallèle, rendu séquentiel (satori bloque la boucle); une
 * langue en échec (police, traduction) n'empêche pas les autres.
 *
 * POST ?preview=1  body: { template, locale } → JPEG de la langue avec le modèle
 * NON enregistré du formulaire. Rien n'est écrit.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const project = loadProject(projectId);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

  const body = ((await request.json().catch(() => ({}))) ?? {}) as {
    locales?: unknown;
    onlyMissing?: unknown;
    texts?: unknown;
    resetManual?: unknown;
    template?: unknown;
    locale?: unknown;
  };
  if (new URL(request.url).searchParams.get("preview") === "1") {
    return preview(project, body);
  }

  if (!readFeatureGraphicTemplate(project.id)) {
    return Response.json({ error: "Save the banner template first." }, { status: 400 });
  }
  if (!findFeatureGraphicArt(project.id)) {
    return Response.json({ error: "Upload the banner illustration first." }, { status: 400 });
  }

  const allowed = new Set(projectLocales(project));
  const requested = Array.isArray(body.locales)
    ? body.locales.map(String).filter((l) => allowed.has(l))
    : [...allowed];
  const manualTexts = body.texts !== undefined ? sanitizeFeatureGraphicTexts(body.texts) : undefined;
  if (manualTexts && requested.length !== 1) {
    return Response.json({ error: "Manual texts apply to exactly one language." }, { status: 400 });
  }
  const locales =
    body.onlyMissing === true
      ? requested.filter((l) => !hasLocaleFeatureGraphic(project.id, l))
      : requested;

  const ctx = loadFeatureGraphicContext(project.id);
  const titles = listingTitles(project.id);
  const [, resolved] = await Promise.all([
    warmFonts(locales),
    mapWithConcurrency(locales, TRANSLATE_CONCURRENCY, async (locale) => {
      try {
        const listingTitle = titles.get(locale) ?? null;
        const r = await resolveLocaleFeatureGraphicTexts(ctx, {
          sourceLocale: project.source_locale,
          locale,
          listingTitle,
          texts: manualTexts,
          resetManual: body.resetManual === true,
        });
        return { locale, listingTitle, ...r };
      } catch (e) {
        return { locale, error: e instanceof Error ? e.message : "Translation failed." };
      }
    }),
  ]);

  const done: LocaleFeatureGraphic[] = [];
  const failed: { locale: string; error: string }[] = [];
  for (const r of resolved) {
    if ("error" in r) {
      failed.push({ locale: r.locale, error: r.error ?? "Translation failed." });
      continue;
    }
    try {
      done.push(await saveLocaleFeatureGraphic(ctx, r));
    } catch (e) {
      failed.push({ locale: r.locale, error: e instanceof Error ? e.message : "Render failed." });
    }
  }
  return Response.json({ done, failed });
}

async function preview(
  project: Project,
  body: { template?: unknown; locale?: unknown }
): Promise<Response> {
  if (!findFeatureGraphicArt(project.id)) {
    return Response.json({ error: "Upload the banner illustration first." }, { status: 400 });
  }
  const locale =
    typeof body.locale === "string" && projectLocales(project).includes(body.locale)
      ? body.locale
      : project.source_locale;
  const ctx = loadFeatureGraphicContext(
    project.id,
    sanitizeFeatureGraphicTemplate(body.template)
  );
  try {
    const { texts } = await resolveLocaleFeatureGraphicTexts(ctx, {
      sourceLocale: project.source_locale,
      locale,
      listingTitle: listingTitles(project.id).get(locale) ?? null,
    });
    await warmFonts([locale]);
    const jpeg = await renderFeatureGraphic({
      template: ctx.template,
      texts,
      artDataUrl: ctx.artDataUrl,
      locale,
    });
    return new Response(new Uint8Array(jpeg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Preview failed." },
      { status: 500 }
    );
  }
}
