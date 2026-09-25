import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreUpdate } from "@/lib/publish/types";

// `actions.ts` est un module "use server": on coupe le cache Next, la base et
// l'envoi vers les stores pour ne tester que l'orchestration. Seuls les locales
// réellement passés à `publishListings` nous intéressent.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const listListings = vi.fn();
const getProject = vi.fn();
vi.mock("@/lib/db", () => ({
  getProject: (...args: unknown[]) => getProject(...args),
  listListings: (...args: unknown[]) => listListings(...args),
}));

const buildUpdatesFromListings = vi.fn();
const publishListings = vi.fn();
vi.mock("@/lib/publish", () => ({
  buildUpdatesFromListings: (...args: unknown[]) => buildUpdatesFromListings(...args),
  publishListings: (...args: unknown[]) => publishListings(...args),
  deleteStoreCredentials: vi.fn(),
  saveStoreCredentials: vi.fn(),
}));

import { publishProjectListings } from "./actions";

const ALL_LOCALES = ["fr-FR", "en-US", "de-DE"];

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockReturnValue({
    id: "p1",
    user_id: "u1",
    store: "playstore",
    target_locales: JSON.stringify(ALL_LOCALES),
  });
  listListings.mockReturnValue(ALL_LOCALES.map((locale) => ({ locale, title: `t-${locale}` })));
  buildUpdatesFromListings.mockImplementation(
    async (_project: unknown, listings: { locale: string }[]): Promise<StoreUpdate[]> =>
      listings.map((l) => ({ locale: l.locale })),
  );
  publishListings.mockResolvedValue({ ok: true, message: "ok", perLocale: [] });
});

describe("publishProjectListings locale selection", () => {
  // Régression: le client publie une langue par requête (LOCALE_BATCH_SIZE = 1),
  // mais `locales` n'était jamais appliqué aux fiches: chaque requête re-publiait
  // TOUTES les langues (87 requêtes × 87 langues, ~18 s chacune) et le bouton
  // « Publishing… » semblait tourner sans fin.
  it("only builds and publishes the requested locales (the bug)", async () => {
    await publishProjectListings({ projectId: "p1", locales: ["fr-FR"] });

    const listingsPassed = buildUpdatesFromListings.mock.calls[0][1] as { locale: string }[];
    expect(listingsPassed.map((l) => l.locale)).toEqual(["fr-FR"]);

    const updatesPassed = publishListings.mock.calls[0][1] as StoreUpdate[];
    expect(updatesPassed.map((u) => u.locale)).toEqual(["fr-FR"]);
  });

  it("keeps a multi-locale batch intact", async () => {
    await publishProjectListings({ projectId: "p1", locales: ["fr-FR", "de-DE"] });

    const updatesPassed = publishListings.mock.calls[0][1] as StoreUpdate[];
    expect(updatesPassed.map((u) => u.locale)).toEqual(["fr-FR", "de-DE"]);
  });

  it("ignores requested locales that are not project targets", async () => {
    await publishProjectListings({ projectId: "p1", locales: ["fr-FR", "xx-XX"] });

    const updatesPassed = publishListings.mock.calls[0][1] as StoreUpdate[];
    expect(updatesPassed.map((u) => u.locale)).toEqual(["fr-FR"]);
  });

  it("reports an error when no listing exists for the requested locales", async () => {
    listListings.mockReturnValue([{ locale: "en-US", title: "t" }]);

    const res = await publishProjectListings({ projectId: "p1", locales: ["fr-FR"] });

    expect(res.error).toMatch(/No listing saved/);
    expect(publishListings).not.toHaveBeenCalled();
  });
});
