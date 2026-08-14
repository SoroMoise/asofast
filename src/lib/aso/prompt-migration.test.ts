import { describe, it, expect, vi, beforeEach } from "vitest";

// Characterization tests: lock the EXACT (system, user) strings each prompt
// currently sends to OpenAI. Snapshotted against the pre-migration code, so the
// move of these prompts into the `prompts` table (DEFAULTS + renderTemplate)
// must reproduce them byte-for-byte or these fail.
//
// The provider is mocked (no network). `@/lib/db` is mocked to throw
// so that, once the call sites use getPrompt, its DB path fails fast and falls
// back to DEFAULTS in-process (hermetic, no eager env parse).
vi.mock("@/lib/ai/providers/openai", () => ({
  completeJSON: vi.fn(),
  completeJSONWithImages: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("no db in tests");
  },
}));
// screenshots.ts imports render.tsx (JSX) at module load; it is unrelated to the
// caption prompts under test and vitest cannot transform the .tsx here.
vi.mock("@/lib/ai/generation/screenshot/render", () => ({ renderFrame: vi.fn() }));

import * as openai from "@/lib/ai/providers/openai";
import { generateCopy } from "@/lib/ai/generation/copy";
import { generateTranslation } from "@/lib/ai/generation/translation";
import { extractStyleProfile, generateCaptions } from "@/lib/ai/generation/screenshot/style";
import type { AppMetadata } from "@/lib/scrapers";

import { translateKeywords, translateWhatsNew } from "./translate";
import { captionUserScreenshots, translateCaptions } from "./screenshots";
import { generateListingCopy } from "./generate";
import type { KeywordEntry } from "./types";

const mComplete = vi.mocked(openai.completeJSON);
const mVision = vi.mocked(openai.completeJSONWithImages);

const meta = (over: Partial<AppMetadata> = {}): AppMetadata => ({
  store: "appstore",
  storeIdentifier: "123",
  title: "Photo Editor Pro",
  subtitle: "Edit photos fast",
  description: "Crop, filter and retouch your photos in seconds.",
  developer: "Acme Labs",
  categories: ["Photo & Video", "Productivity"],
  screenshots: [],
  icon: null,
  rating: null,
  locale: null,
  url: null,
  ...over,
});

const kw = (keyword: string): KeywordEntry => ({ keyword, competitors: 2, occurrences: 3 });

beforeEach(() => {
  vi.clearAllMocks();
  mComplete.mockResolvedValue({});
  mVision.mockResolvedValue({});
});

describe("prompt characterization (pre-migration lock)", () => {
  it("aso_generate_copy", async () => {
    await generateCopy(meta(), "fr-FR");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_translate_listing", async () => {
    await generateTranslation(meta(), "en-US", "fr-FR");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_screenshot_style", async () => {
    await extractStyleProfile(["https://ex/1.png"]);
    expect(mVision.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mVision.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_screenshot_captions", async () => {
    await generateCaptions(meta(), 3, "fr-FR");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_translate_keywords", async () => {
    mComplete.mockResolvedValue({ translations: ["montage video", "filtre"] });
    await translateKeywords([kw("video editing"), kw("filter")], "fr-FR");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_translate_whats_new", async () => {
    mComplete.mockResolvedValue({ text: "Corrections de bugs" });
    await translateWhatsNew("Bug fixes\nNew: dark mode", "fr-FR");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_caption_screenshots", async () => {
    await captionUserScreenshots("Photo Editor Pro", "en-US", [
      { path: "a.png", dataUrl: "data:image/png;base64,AAA" },
      { path: "b.png", dataUrl: "data:image/png;base64,BBB" },
    ]);
    expect(mVision.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mVision.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_translate_captions", async () => {
    mComplete.mockResolvedValue({ captions: ["Retouche rapide", "Filtres pro"] });
    await translateCaptions(["Fast edits", "Pro filters"], "en-US", "fr-FR");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  const appStore = { name: "Photo Editor Pro", developer: "Acme Labs" };
  const keys = [kw("photo editor"), kw("filters")];

  it("aso_generate_listing_appstore (no privacy)", async () => {
    await generateListingCopy("appstore", appStore, "fr-FR", keys, "");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_generate_listing_appstore (with privacy)", async () => {
    await generateListingCopy("appstore", appStore, "fr-FR", keys, "https://ex/privacy");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_generate_listing_playstore (no privacy)", async () => {
    await generateListingCopy("playstore", appStore, "fr-FR", keys, "");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("aso_generate_listing_playstore (with privacy)", async () => {
    await generateListingCopy("playstore", appStore, "fr-FR", keys, "https://ex/privacy");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
    expect(mComplete.mock.calls[0][1]).toMatchSnapshot("user");
  });

  it("appstore developer-less name has no developer suffix", async () => {
    await generateListingCopy("appstore", { name: "Solo", developer: null }, "en-US", keys, "");
    expect(mComplete.mock.calls[0][0]).toMatchSnapshot("system");
  });
});
