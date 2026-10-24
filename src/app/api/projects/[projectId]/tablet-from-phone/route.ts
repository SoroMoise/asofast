import {
  listUserScreenshots,
  loadSourceImages,
  renderLocaleFrames,
  SCREENSHOT_STYLE,
  type ScreenshotFrame,
  type SourceCaption,
} from "@/lib/aso";
import {
  getProject as dbGetProject,
  listListings as dbListListings,
  updateProject as dbUpdateProject,
  upsertListing as dbUpsertListing,
} from "@/lib/db";
import { parseListing, parseProject } from "@/lib/db/parse";

export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * POST /api/projects/{projectId}/tablet-from-phone  body: { locales?: string[] }
 *
 * Rend les captures TABLETTE de chaque langue en reutilisant les legendes deja
 * generees (et eventuellement corrigees a la main) des captures TELEPHONE de la
 * meme langue. Les sources tablette doivent etre dans le meme ordre et en meme
 * nombre que les sources telephone (meme histoire, autre format). Aucun appel
 * IA: pas de nouvelle traduction, donc les legendes restent coherentes entre
 * telephone et tablette. La legende source (source_locale) devient aussi la base
 * tablette du projet. Avec { phone: true }, les captures telephone sont aussi
 * re-rendues avec leurs legendes actuelles.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { locales?: unknown; phone?: unknown };
  const rerenderPhone = body.phone === true;
  const only = Array.isArray(body.locales) ? body.locales.map(String) : null;

  const project = parseProject(dbGetProject(projectId) ?? {});
  if (!project.id) return Response.json({ error: "Project not found." }, { status: 404 });

  const tabletPaths = await listUserScreenshots(project, "tablet");
  if (tabletPaths.length === 0) {
    return Response.json({ error: "No tablet screenshot uploaded." }, { status: 400 });
  }
  const sources = await loadSourceImages(tabletPaths);

  const listings = dbListListings(project.id).map((row) => parseListing(row));
  const phoneCaptions = (locale: string): string[] | null => {
    const listing = listings.find((l) => l.locale === locale);
    const frames = (Array.isArray(listing?.screenshots)
      ? listing.screenshots
      : []) as unknown as ScreenshotFrame[];
    return frames.length === sources.length ? frames.map((f) => f.caption) : null;
  };

  const base = phoneCaptions(project.source_locale);
  if (!base) {
    return Response.json(
      { error: "Phone screenshots of the source language missing or count mismatch." },
      { status: 400 }
    );
  }
  const baseCaptions: SourceCaption[] = sources.map((s, i) => ({ path: s.path, caption: base[i] }));
  dbUpdateProject(project.id, { screenshot_captions_tablet: baseCaptions });

  const done: string[] = [];
  const failed: { locale: string; error: string }[] = [];
  for (const listing of listings) {
    const locale = String(listing.locale);
    if (only && !only.includes(locale)) continue;
    const captions = phoneCaptions(locale);
    if (!captions) {
      failed.push({ locale, error: "phone screenshots missing or count mismatch" });
      continue;
    }
    try {
      const entries = sources.map((s, i) => ({ ...s, caption: captions[i] }));
      const frames = await renderLocaleFrames(project, locale, entries, SCREENSHOT_STYLE, "tablet");
      dbUpsertListing(project.id, locale, { screenshots_tablet: frames });
      if (rerenderPhone) {
        // Re-rend aussi les captures telephone avec leurs legendes actuelles
        // (utile apres un correctif de mise en page, sans retraduire).
        const phonePaths = await listUserScreenshots(project);
        const phoneSources = await loadSourceImages(phonePaths);
        if (phoneSources.length === captions.length) {
          const phoneEntries = phoneSources.map((s, i) => ({ ...s, caption: captions[i] }));
          const phoneFrames = await renderLocaleFrames(project, locale, phoneEntries, SCREENSHOT_STYLE);
          dbUpsertListing(project.id, locale, { screenshots: phoneFrames });
        }
      }
      done.push(locale);
    } catch (e) {
      failed.push({ locale, error: e instanceof Error ? e.message : "render failed" });
    }
  }

  return Response.json({ done, failed });
}
