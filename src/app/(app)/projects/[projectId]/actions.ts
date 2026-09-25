"use server";

import { revalidatePath } from "next/cache";

import { getProject as dbGetProject, listListings as dbListListings } from "@/lib/db";
import {
  buildUpdatesFromListings,
  deleteStoreCredentials,
  publishListings,
  saveStoreCredentials,
} from "@/lib/publish";
import { FULL_SCOPE, isEmptyScope } from "@/lib/publish/scope";
import type {
  AppStoreCredentials,
  LocaleResult,
  PlayStoreCredentials,
  PublishProgress,
  PublishScope,
} from "@/lib/publish/types";
import { parseListing, parseProject } from "@/lib/db/parse";

export type GenerateState = { error?: string; message?: string };

export type PublishState = {
  error?: string;
  message?: string;
  perLocale?: LocaleResult[];
  editId?: string;
};

export async function connectStore(
  prevState: GenerateState,
  formData: FormData
): Promise<GenerateState> {
  const projectId = String(formData.get("project_id") ?? "");
  const project = parseProject(dbGetProject(projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  let creds: AppStoreCredentials | PlayStoreCredentials;
  if (project.store === "appstore") {
    const keyId = String(formData.get("key_id") ?? "").trim();
    const issuerId = String(formData.get("issuer_id") ?? "").trim();
    const privateKey = String(formData.get("private_key") ?? "").trim();
    if (!keyId || !issuerId || !privateKey) {
      return { error: "Key ID, Issuer ID and .p8 private key required." };
    }
    creds = { keyId, issuerId, privateKey };
  } else {
    const serviceAccountJson = String(formData.get("service_account_json") ?? "").trim();
    if (!serviceAccountJson) return { error: "Service account JSON required." };
    try {
      JSON.parse(serviceAccountJson);
    } catch {
      return { error: "The service account JSON is invalid." };
    }
    creds = { serviceAccountJson };
  }

  await saveStoreCredentials({ userId: project.user_id, projectId: project.id }, project.store, creds);

  if (project.store === "appstore") revalidatePath("/", "layout");
  revalidatePath(`/projects/${project.id}`);
  return { message: "Store connected." };
}

export async function publishProjectListings(input: {
  projectId: string;
  locales: string[];
  commit?: boolean;
  editId?: string;
  changesNotSentForReview?: boolean;
  scope?: PublishScope;
  onProgress?: PublishProgress;
}): Promise<PublishState> {
  const project = parseProject(dbGetProject(input.projectId) ?? {});
  if (!project.id) return { error: "Project not found." };

  const locales = input.locales.filter((l) => project.target_locales.includes(l));
  if (locales.length === 0) return { error: "No target language to publish." };

  const scope = input.scope ?? FULL_SCOPE;
  if (isEmptyScope(scope, project.store)) {
    return { error: "Tick at least one thing to publish under What to publish." };
  }

  // Le client publie par lots (1 langue/requête): ne construire et n'envoyer que
  // les langues demandées, sinon chaque requête re-publie TOUTES les fiches.
  const requested = new Set(locales);
  const listings = dbListListings(project.id)
    .map((r) => parseListing(r))
    .filter((l) => requested.has(l.locale));

  if (listings.length === 0) {
    return { error: "No listing saved for these languages: generate them first." };
  }

  try {
    const updates = await buildUpdatesFromListings(project, listings, scope);
    const result = await publishListings(project, updates, {
      commit: Boolean(input.commit),
      editId: input.editId,
      changesNotSentForReview: input.changesNotSentForReview,
      scope,
      onProgress: input.onProgress,
    });
    revalidatePath(`/projects/${project.id}`);
    if (!result.ok) {
      return { error: result.message, perLocale: result.perLocale, editId: result.editId };
    }
    return { message: result.message, perLocale: result.perLocale, editId: result.editId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Publishing failed.";
    console.error(
      `[publish] project=${project.id} store=${project.store} locales=${locales.join(",")}: ${msg}`
    );
    return {
      error: msg,
      perLocale: locales.map((locale) => ({ locale, updatedFields: [], error: msg })),
    };
  }
}

export async function disconnectStore(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  const project = parseProject(dbGetProject(projectId) ?? {});
  if (!project.id) return;

  await deleteStoreCredentials({ userId: project.user_id, projectId: project.id }, project.store);

  if (project.store === "appstore") revalidatePath("/", "layout");
  revalidatePath(`/projects/${project.id}`);
}
