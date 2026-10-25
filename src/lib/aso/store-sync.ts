import { mapWithConcurrency } from "@/lib/concurrency";
import { updateProject } from "@/lib/db";
import type { Project } from "@/types";

import { lookupApp } from "./lookup";
import type { AppRef } from "./types";

/** Délai mini entre deux vérifications automatiques d'un même projet. */
const AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Une page ne doit pas attendre un store lent: au-delà, on réessaiera plus tard. */
const LOOKUP_TIMEOUT_MS = 5000;

const lastChecks = new Map<string, number>();

/**
 * Projet sans métadonnées store: créé en saisie manuelle (app pas encore
 * publiée), ou marqué publié à la main avant que le store ne l'expose.
 */
export function needsStoreSync(project: Pick<Project, "published" | "icon_url">): boolean {
  return !project.published || !project.icon_url;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Store lookup timed out.")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Champs projet à écrire une fois l'app trouvée sur le store. */
export function publishedPatch(app: AppRef) {
  return {
    name: app.name,
    app_name: app.name,
    developer_name: app.developer,
    icon_url: app.icon,
    published: 1,
  };
}

/**
 * Cherche l'app du projet sur son store. Trouvée: le projet passe publié et
 * prend nom, développeur et icône du store. Renvoie le projet à jour, ou null si
 * l'app n'est pas (encore) visible. `force` ignore le délai entre vérifications.
 */
export async function syncStoreMetadata(
  project: Project,
  opts: { force?: boolean; lookup?: typeof lookupApp; update?: typeof updateProject } = {}
): Promise<Project | null> {
  const lookup = opts.lookup ?? lookupApp;
  const update = opts.update ?? updateProject;

  if (!opts.force) {
    const last = lastChecks.get(project.id);
    if (last !== undefined && Date.now() - last < AUTO_CHECK_INTERVAL_MS) return null;
  }
  lastChecks.set(project.id, Date.now());

  let app: AppRef;
  try {
    app = await withTimeout(lookup(project.store, project.store_identifier), LOOKUP_TIMEOUT_MS);
  } catch {
    return null;
  }

  const patch = publishedPatch(app);
  update(project.id, patch);
  lastChecks.delete(project.id);
  return { ...project, ...patch, published: true };
}

/**
 * Vérification automatique au chargement d'une page: seuls les projets sans
 * métadonnées store sont interrogés, au plus une fois par intervalle.
 */
export async function syncUnpublishedProjects(projects: Project[]): Promise<Project[]> {
  return mapWithConcurrency(projects, 4, async (p) =>
    needsStoreSync(p) ? ((await syncStoreMetadata(p)) ?? p) : p
  );
}

/** Tests uniquement. */
export function resetStoreSyncThrottle(): void {
  lastChecks.clear();
}
