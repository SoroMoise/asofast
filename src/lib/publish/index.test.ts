import { afterEach, describe, expect, it, vi } from "vitest";

import type { Listing, Project } from "@/types";

// `index.ts` importe le client db. Ces tests portent sur un projet App Store,
// qui ne touche jamais au bucket (icône et feature graphic sont Play-only): on
// coupe la dépendance au lieu de fabriquer un faux environnement. Le throw rend
// bruyant tout appel qui contredirait cette hypothèse.
vi.mock("@/lib/db", () => ({
  getStoreCredentials: () => { throw new Error("getStoreCredentials should not be reached by these tests"); },
  listListings: () => { throw new Error("listListings should not be reached by these tests"); },
  getProject: () => { throw new Error("getProject should not be reached by these tests"); },
}));

import { appendLegalLinks, buildUpdatesFromListings } from "./index";

const APPLE_EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula";
const PRIVACY = "https://example.com/privacy";

// --- appendLegalLinks ------------------------------------------------------

describe("appendLegalLinks", () => {
  // Régression: le `return` anticipé sur `!privacyUrl` faisait sauter l'EULA
  // Apple aussi, alors que son URL est fixe et ne doit rien à la privacy policy.
  // Hors d'atteinte tant qu'un gate interdisait de publier sans URL privacy, à
  // portée depuis sa suppression.
  it("still appends the Apple EULA when there is no privacy URL (the bug)", () => {
    const out = appendLegalLinks("Ma description.", "appstore", "");
    expect(out).toContain(`EULA : ${APPLE_EULA_URL}`);
    expect(out).not.toContain("Privacy policy :");
  });

  it("appends both links when the privacy URL is set", () => {
    const out = appendLegalLinks("Ma description.", "appstore", PRIVACY);
    expect(out).toContain(`Privacy policy : ${PRIVACY}`);
    expect(out).toContain(`EULA : ${APPLE_EULA_URL}`);
  });

  it("does not duplicate a link already present", () => {
    const described = `Ma description.\n\nPrivacy policy : ${PRIVACY}`;
    const out = appendLegalLinks(described, "appstore", PRIVACY);
    expect(out?.match(/Privacy policy :/g)).toHaveLength(1);
    expect(out).toContain(`EULA : ${APPLE_EULA_URL}`);
  });

  it("leaves a description that already has both links untouched", () => {
    const described = `Ma description.\n\nPrivacy policy : ${PRIVACY}\nEULA : ${APPLE_EULA_URL}`;
    expect(appendLegalLinks(described, "appstore", PRIVACY)).toBe(described);
  });

  it("never adds an EULA on Play Store", () => {
    expect(appendLegalLinks("Ma description.", "playstore", PRIVACY)).not.toContain("EULA");
    // Play + URL vide: plus rien à ajouter, description rendue telle quelle.
    expect(appendLegalLinks("Ma description.", "playstore", "")).toBe("Ma description.");
  });

  it("adds the privacy line even though includes('') is true for any string", () => {
    // Piège: tester `description.includes(privacyUrl)` AVANT la non-vacuité
    // ferait sauter la ligne pour toute URL, puisque `"abc".includes("")` vaut
    // true. L'ordre des tests est donc porteur de sens, pas cosmétique.
    expect("abc".includes("")).toBe(true);
    expect(appendLegalLinks("abc", "playstore", PRIVACY)).toContain(`Privacy policy : ${PRIVACY}`);
  });

  it("keeps the whole suffix by truncating the description under 4000 chars", () => {
    const out = appendLegalLinks("x".repeat(4000), "appstore", PRIVACY);
    expect(out?.length).toBeLessThanOrEqual(4000);
    expect(out).toContain(`Privacy policy : ${PRIVACY}`);
    expect(out).toContain(`EULA : ${APPLE_EULA_URL}`);
  });

  it("returns undefined for an absent description", () => {
    expect(appendLegalLinks(undefined, "appstore", PRIVACY)).toBeUndefined();
  });
});

// --- buildUpdatesFromListings ----------------------------------------------

const project = {
  id: "p1",
  user_id: "u1",
  store: "appstore",
  privacy_policy_url: PRIVACY,
} as unknown as Project;

const listing = {
  locale: "fr-FR",
  title: "Titre",
  subtitle: "Sous-titre",
  short_description: "Court",
  description: "Ma description.",
  keywords: "aso, store",
  whats_new: "Nouveautés",
  screenshots: [{ url: "https://storage/01.jpg" }, { url: "https://storage/02.jpg" }],
  screenshots_tablet: [],
} as unknown as Listing;

/** Réponse image minimale pour les downloads de frames. */
function imageResponse(): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode("jpg").buffer,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildUpdatesFromListings scope", () => {
  it("downloads nothing when screenshots are unchecked (where the time is saved)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal("fetch", fetchMock);

    const [update] = await buildUpdatesFromListings(project, [listing], {
      text: true,
      screenshots: false,
      storeAssets: true,
      privacyAndWhatsNew: true,
    });

    // Le point du correctif: pas d'upload sauté APRÈS coup, aucun GET storage
    // du tout. C'est là que partent 5 requêtes par langue.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update.screenshots).toBeUndefined();
    expect(update.screenshotsTablet).toBeUndefined();
    expect(update.metadata?.title).toBe("Titre");
  });

  it("sends no metadata when the listing text is unchecked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));

    const [update] = await buildUpdatesFromListings(project, [listing], {
      text: false,
      screenshots: true,
      storeAssets: true,
      privacyAndWhatsNew: false,
    });

    expect(update.metadata).toBeUndefined();
    expect(update.screenshots).toHaveLength(2);
  });

  it("sends both under the full scope, and defaults to the full scope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));

    const [explicit] = await buildUpdatesFromListings(project, [listing], {
      text: true,
      screenshots: true,
      storeAssets: true,
      privacyAndWhatsNew: true,
    });
    expect(explicit.metadata?.title).toBe("Titre");
    expect(explicit.screenshots).toHaveLength(2);

    // Scope omis = tout publier, pour tout appelant qui ignore l'option.
    const [byDefault] = await buildUpdatesFromListings(project, [listing]);
    expect(byDefault.metadata?.title).toBe("Titre");
    expect(byDefault.screenshots).toHaveLength(2);
  });

  it("drops a locale that has nothing left to send under the chosen scope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));
    const noShots = { ...listing, screenshots: [], screenshots_tablet: [] } as unknown as Listing;

    const updates = await buildUpdatesFromListings(project, [noShots], {
      text: false,
      screenshots: true,
      storeAssets: true,
      privacyAndWhatsNew: false,
    });

    // Ni texte (décoché) ni screenshots (absents) => rien à publier pour cette
    // langue. Elle sort de la liste au lieu de partir vide vers le store.
    expect(updates).toHaveLength(0);
  });

  it("sends privacy policy and What's New alone, without the listing text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));

    // Le cas d'usage de la case: mise à jour de version. Seuls les deux champs
    // qui bougent partent, sans repousser titre/description/mots-clés (ni leurs
    // rejets ASC) ni retélécharger une frame.
    const [update] = await buildUpdatesFromListings(project, [listing], {
      text: false,
      screenshots: false,
      storeAssets: false,
      privacyAndWhatsNew: true,
    });

    expect(update.metadata?.whatsNew).toBe("Nouveautés");
    expect(update.metadata?.title).toBeUndefined();
    expect(update.metadata?.description).toBeUndefined();
    expect(update.privacyPolicyUrl).toBe(PRIVACY);
  });

  it("drops both when the box is unticked, listing text or not", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));

    const [update] = await buildUpdatesFromListings(project, [listing], {
      text: true,
      screenshots: false,
      storeAssets: false,
      privacyAndWhatsNew: false,
    });

    expect(update.metadata?.whatsNew).toBeUndefined();
    expect(update.privacyPolicyUrl).toBeUndefined();
    // La ligne « Privacy policy » de la description relève du texte de fiche,
    // pas de la case: elle reste attachée tant que « Listing text » est coché.
    expect(update.metadata?.description).toContain(`Privacy policy : ${PRIVACY}`);
  });

  it("never sends the App Store block on Play Store", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));
    const playProject = { ...project, store: "playstore" } as unknown as Project;

    // Play n'a ni champ privacy policy ni release notes ici: la case cochée ne
    // doit rien fabriquer (sinon une langue partirait vide vers l'API Google).
    const updates = await buildUpdatesFromListings(playProject, [listing], {
      text: false,
      screenshots: false,
      storeAssets: false,
      privacyAndWhatsNew: true,
    });

    expect(updates).toHaveLength(0);
  });
});
