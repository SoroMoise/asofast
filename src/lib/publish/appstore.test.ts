import { describe, expect, it } from "vitest";

import { selectEditableAppInfo } from "./appstore";

// Un appInfo minimal tel que renvoyé par ASC (seul appStoreState nous importe).
const appInfo = (id: string, appStoreState: string) => ({
  id,
  attributes: { appStoreState },
});

describe("selectEditableAppInfo", () => {
  // Régression: une app en ligne + mise à jour en préparation expose DEUX
  // appInfos. ASC a renvoyé le LIVE en premier -> l'ancien `data[0]` visait le
  // live (jeu de langues figé), donc les langues cibles absentes gardaient le
  // nom/sous-titre par défaut (anglais). On doit cibler le brouillon éditable.
  it("targets the editable draft, not the live appInfo returned first (the bug)", () => {
    const list = [
      appInfo("live", "READY_FOR_SALE"),
      appInfo("draft", "PREPARE_FOR_SUBMISSION"),
    ];
    // L'ancien comportement bugué.
    expect(list[0].id).toBe("live");
    // Le comportement corrigé.
    expect(selectEditableAppInfo(list)?.id).toBe("draft");
  });

  it("finds the editable appInfo whatever the order ASC returns", () => {
    const list = [
      appInfo("draft", "PREPARE_FOR_SUBMISSION"),
      appInfo("live", "READY_FOR_SALE"),
    ];
    expect(selectEditableAppInfo(list)?.id).toBe("draft");
  });

  it("falls back to the non-live appInfo once submitted (WAITING_FOR_REVIEW)", () => {
    // État réel observé après soumission: ni l'un ni l'autre n'est éditable,
    // mais le pending reste le bon (non-live).
    const list = [
      appInfo("live", "READY_FOR_SALE"),
      appInfo("pending", "WAITING_FOR_REVIEW"),
    ];
    expect(selectEditableAppInfo(list)?.id).toBe("pending");
  });

  it("returns the single appInfo unchanged (no live/pending split)", () => {
    const list = [appInfo("solo", "READY_FOR_SALE")];
    expect(selectEditableAppInfo(list)?.id).toBe("solo");
  });

  it("returns undefined when there is no appInfo", () => {
    expect(selectEditableAppInfo([])).toBeUndefined();
  });
});
