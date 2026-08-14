import { describe, it, expect, vi, beforeEach } from "vitest";

import * as openai from "@/lib/ai/providers/openai";
import { translateKeywords } from "./translate";
import type { KeywordEntry } from "./types";

vi.mock("@/lib/ai/providers/openai", () => ({ completeJSON: vi.fn() }));
// translateKeywords now loads its prompt via getPrompt (DB + fallback). Force the
// DB path to fail so it uses the embedded DEFAULTS in-process: no network, and no
// eager mock from the db during tests.
vi.mock("@/lib/db", () => ({
  getPrompt: () => {
    throw new Error("no db in tests");
  },
}));
const mockComplete = vi.mocked(openai.completeJSON);
const kw = (keyword: string): KeywordEntry => ({ keyword, competitors: 2, occurrences: 3 });

describe("translateKeywords", () => {
  beforeEach(() => mockComplete.mockReset());

  it("tells the model to leave already-target-language terms and proper nouns unchanged", async () => {
    mockComplete.mockResolvedValue({ translations: ["montage video"] });
    await translateKeywords([kw("video editing")], "fr-FR");
    const system = mockComplete.mock.calls[0][0] as string;
    expect(system.toLowerCase()).toContain("unchanged");
  });

  it("preserves order and ranking signal, deduping colliding translations", async () => {
    mockComplete.mockResolvedValue({ translations: ["editeur", "editeur", "photo"] });
    const out = await translateKeywords(
      [
        { keyword: "a", competitors: 5, occurrences: 9 },
        { keyword: "b", competitors: 1, occurrences: 1 },
        kw("c"),
      ],
      "fr-FR"
    );
    expect(out.map((k) => k.keyword)).toEqual(["editeur", "photo"]);
    // "a" and "b" both translate to "editeur": first-wins on collision, so the
    // surviving entry must keep "a"'s signal, not "b"'s.
    expect(out[0]).toMatchObject({ competitors: 5, occurrences: 9 });
    expect(out[1]).toMatchObject({ competitors: 2, occurrences: 3 });
  });

  it("returns empty without calling the model when there are no keywords", async () => {
    const out = await translateKeywords([], "fr-FR");
    expect(out).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });
});
