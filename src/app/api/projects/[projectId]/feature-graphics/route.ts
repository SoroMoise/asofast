import { warmFonts } from "@/lib/aso";
import {
  DEFAULT_FEATURE_GRAPHIC_TEMPLATE,
  findFeatureGraphicArt,
  generateLocaleFeatureGraphic,
  hasLocaleFeatureGraphic,
  localeFeatureGraphicPaths,
  readFeatureGraphicTemplate,
  readLocaleFeatureGraphicTexts,
  sanitizeFeatureGraphicTexts,
  saveFeatureGraphicTemplate,
  type LocaleFeatureGraphic,
} from "@/lib/aso/feature-graphic";
import { getProject as dbGetProject, listListings as dbListListings } from "@/lib/db";
import { parseListing, parseProject } from "@/lib/db/parse";
import type { Project } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 800;

type Params = { params: Promise<{ projectId: string }> };

function loadProject(projectId: string): Project | null {
  const project = parseProject(dbGetProject(projectId) ?? {});
  return project.id ? project : null;
}

function projectLocales(project: Project): string[] {
  return project.target_locales.length > 0 ? project.target_locales : [project.source_locale];
}

/**
 * GET /api/projects/{id}/feature-graphics
 * État de la bannière localisée: modèle (ou défaut), illustration, et pour
 * chaque langue cible l'URL de la bannière rendue + ses textes (null si absente).
 */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const project = loadProject(projectId);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

  const template = readFeatureGraphicTemplate(project.id);
  const art = findFeatureGraphicArt(project.id);
  const stamp = Date.now();
  const locales = projectLocales(project).map((locale) => {
    const exists = hasLocaleFeatureGraphic(project.id, locale);
    return {
      locale,
      url: exists ? `/api/files/${localeFeatureGraphicPaths(project.id, locale).image}?v=${stamp}` : null,
      texts: exists ? readLocaleFeatureGraphicTexts(project.id, locale) : null,
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
 * body: { locales?: string[], onlyMissing?: boolean, texts?: { headline, badges } }
 * Rend les bannières des langues demandées (défaut: toutes les langues cibles).
 * `texts` = édition manuelle, accepté pour UNE seule langue (aucune traduction).
 * Séquentiel: le rendu satori bloque la boucle, et une langue en échec (police,
 * traduction) n'empêche pas les autres.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const project = loadProject(projectId);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

  const body = ((await request.json().catch(() => ({}))) ?? {}) as {
    locales?: unknown;
    onlyMissing?: unknown;
    texts?: unknown;
  };
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

  const titles = new Map(
    dbListListings(project.id).map((row) => {
      const listing = parseListing(row);
      return [String(listing.locale), String(listing.title ?? "")] as const;
    })
  );

  await warmFonts(locales);
  const done: LocaleFeatureGraphic[] = [];
  const failed: { locale: string; error: string }[] = [];
  for (const locale of locales) {
    try {
      done.push(
        await generateLocaleFeatureGraphic({
          projectId: project.id,
          sourceLocale: project.source_locale,
          locale,
          listingTitle: titles.get(locale) ?? null,
          texts: manualTexts,
        })
      );
    } catch (e) {
      failed.push({ locale, error: e instanceof Error ? e.message : "Render failed." });
    }
  }
  return Response.json({ done, failed });
}
