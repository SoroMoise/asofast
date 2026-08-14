import { getGeneration, getProject, updateGeneration } from "@/lib/db";
import { generateCopy } from "@/lib/ai/generation/copy";
import { generateTranslation } from "@/lib/ai/generation/translation";
import { fetchAppMetadata } from "@/lib/scrapers";
import type { Generation, Json, Project } from "@/types";

/**
 * Execute a pending generation. Runs synchronously against the local SQLite DB.
 * A production system would move this behind a queue/background worker.
 */
export async function runGeneration(generationId: string): Promise<void> {
  const gen = getGeneration(generationId) as unknown as Generation | undefined;
  if (!gen) {
    throw new Error(`Generation ${generationId} not found.`);
  }

  const project = getProject(gen.project_id) as unknown as Project | undefined;
  if (!project) {
    throw new Error(`Project ${gen.project_id} not found.`);
  }

  updateGeneration(generationId, { status: "running" });

  try {
    const targetLocale = gen.target_locale ?? project.source_locale;
    const meta = await fetchAppMetadata(project.store, project.store_identifier, {
      locale: project.source_locale,
    });

    let output: Json;
    if (gen.type === "copy") {
      output = (await generateCopy(meta, targetLocale)) as unknown as Json;
    } else if (gen.type === "translation") {
      output = (await generateTranslation(
        meta,
        project.source_locale,
        targetLocale
      )) as unknown as Json;
    } else if (gen.type === "screenshot") {
      const { generateScreenshots } = await import("@/lib/ai/generation/screenshot");
      output = (await generateScreenshots(gen, project)) as unknown as Json;
    } else {
      throw new Error("Unsupported generation type.");
    }

    updateGeneration(generationId, { status: "done", output });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error.";
    updateGeneration(generationId, { status: "error", output: { error: message } });
  }
}
