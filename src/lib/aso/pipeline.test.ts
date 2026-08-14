import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/scrapers", () => ({ fetchAppMetadata: vi.fn() }));
vi.mock("./keywords-llm", () => ({ extractKeywordsLLM: vi.fn() }));
vi.mock("./translate", () => ({ translateKeywords: vi.fn() }));
vi.mock("./generate", () => ({ generateListingCopy: vi.fn() }));

import { fetchAppMetadata } from "@/lib/scrapers";
import { extractKeywordsLLM } from "./keywords-llm";
import { translateKeywords } from "./translate";
import { generateListingCopy } from "./generate";
import { runLocalePipeline } from "./pipeline";
import type { AppRef, KeywordEntry } from "./types";

const mFetch = vi.mocked(fetchAppMetadata);
const mExtract = vi.mocked(extractKeywordsLLM);
const mTranslate = vi.mocked(translateKeywords);
const mGenerate = vi.mocked(generateListingCopy);

const app = { name: "App", developer: null, features: [] as string[] };
const comp: AppRef = { store: "appstore", identifier: "123", name: "C", developer: null, icon: null };
const kw = (keyword: string): KeywordEntry => ({ keyword, competitors: 1, occurrences: 1 });
// La base passee a generateListingCopy est son 4e argument.
const baseUsed = () => (mGenerate.mock.calls[0][3] as KeywordEntry[]).map((k) => k.keyword);

beforeEach(() => {
  vi.clearAllMocks();
  mGenerate.mockResolvedValue({
    title: "t", subtitle: "s", shortDescription: "", description: "d", keywords: "",
  } as never);
  mFetch.mockResolvedValue({
    store: "appstore", title: "", subtitle: null, description: "",
  } as never);
});

describe("runLocalePipeline", () => {
  it("translates the native competitor base into a non-English locale", async () => {
    mExtract.mockResolvedValue(new Map([["video editor", 5]]));
    mTranslate.mockResolvedValue([kw("editeur video")]);

    const r = await runLocalePipeline("appstore", app, [comp], "fr-FR", []);

    expect(mTranslate).toHaveBeenCalledOnce();
    expect(mTranslate.mock.calls[0][1]).toBe("fr-FR");
    expect(r.keywordBase.map((k) => k.keyword)).toEqual(["editeur video"]);
    expect(baseUsed()).toEqual(["editeur video"]);
  });

  it("merges raw features on top of the base and translates them together in one pass", async () => {
    mExtract.mockResolvedValue(new Map([["video editor", 5]]));
    mTranslate.mockImplementation(async (kws) =>
      kws.map((k) => ({ ...k, keyword: `x-${k.keyword}` }))
    );

    const r = await runLocalePipeline(
      "appstore",
      { ...app, features: ["ai avatar"] },
      [comp],
      "fr-FR",
      []
    );

    // features prepended raw (lowercased) before the base, whole list sent to translate in order
    expect(mTranslate).toHaveBeenCalledOnce();
    expect(mTranslate.mock.calls[0][0].map((k) => k.keyword)).toEqual([
      "ai avatar",
      "video editor",
    ]);
    // translated output flows to the listing
    expect(r.keywordBase.map((k) => k.keyword)).toEqual(["x-ai avatar", "x-video editor"]);
    expect(baseUsed()).toEqual(["x-ai avatar", "x-video editor"]);
  });

  it("falls back to the cached English base then translates when native extraction is empty", async () => {
    mExtract.mockRejectedValue(new Error("no keyword")); // capte -> base native vide
    mTranslate.mockResolvedValue([kw("traqueur")]);

    const r = await runLocalePipeline("appstore", app, [comp], "de-DE", [kw("tracker")]);

    expect(mTranslate).toHaveBeenCalledOnce();
    expect(mTranslate).toHaveBeenCalledWith([kw("tracker")], "de-DE");
    expect(r.keywordBase.map((k) => k.keyword)).toEqual(["traqueur"]);
  });

  it("uses the English base raw for English locales without translating or fetching", async () => {
    await runLocalePipeline("appstore", app, [comp], "en-US", [kw("tracker")]);

    expect(mTranslate).not.toHaveBeenCalled();
    expect(mFetch).not.toHaveBeenCalled();
    expect(baseUsed()).toEqual(["tracker"]);
  });

  it("uses a manual keyword override as-is, never translating or fetching", async () => {
    const override = [kw("mot cle manuel")];

    const r = await runLocalePipeline("appstore", app, [comp], "fr-FR", [], override);

    expect(mFetch).not.toHaveBeenCalled();
    expect(mTranslate).not.toHaveBeenCalled();
    expect(r.keywordBase).toEqual(override);
    expect(baseUsed()).toEqual(["mot cle manuel"]);
  });

  it("degrades to the untranslated base when translation fails", async () => {
    mExtract.mockResolvedValue(new Map([["video editor", 5]]));
    mTranslate.mockRejectedValue(new Error("openai down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await runLocalePipeline("appstore", app, [comp], "fr-FR", []);

    expect(r.keywordBase.map((k) => k.keyword)).toEqual(["video editor"]);
    expect(baseUsed()).toEqual(["video editor"]);
    // I1: the degrade is silent to the caller but must be observable in logs.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("fr-FR");
    warnSpy.mockRestore();
  });

  it("degrades to the untranslated base when translation returns empty", async () => {
    mExtract.mockResolvedValue(new Map([["video editor", 5]]));
    mTranslate.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await runLocalePipeline("appstore", app, [comp], "fr-FR", []);

    expect(r.keywordBase.map((k) => k.keyword)).toEqual(["video editor"]);
    expect(baseUsed()).toEqual(["video editor"]);
    // I1: the degrade is silent to the caller but must be observable in logs.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("fr-FR");
    warnSpy.mockRestore();
  });
});
