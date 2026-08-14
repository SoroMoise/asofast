import { describe, it, expect } from "vitest";

import { competitorSetKey, mergeFeatureKeywords } from "./keywords";
import type { AppRef, KeywordEntry } from "./types";

const ref = (identifier: string): AppRef => ({
  store: "appstore",
  identifier,
  name: identifier,
  developer: null,
  icon: null,
});
const kw = (keyword: string): KeywordEntry => ({ keyword, competitors: 2, occurrences: 3 });

describe("competitorSetKey", () => {
  it("is independent of competitor order", () => {
    expect(competitorSetKey([ref("a"), ref("b"), ref("c")])).toBe(
      competitorSetKey([ref("c"), ref("a"), ref("b")])
    );
  });
  it("changes when a competitor is added or removed", () => {
    const two = competitorSetKey([ref("a"), ref("b")]);
    expect(competitorSetKey([ref("a"), ref("b"), ref("c")])).not.toBe(two);
    expect(competitorSetKey([ref("a")])).not.toBe(two);
  });
});

describe("mergeFeatureKeywords", () => {
  it("prepends features before the competitor base", () => {
    const out = mergeFeatureKeywords([kw("video editor")], ["AI avatar"]);
    expect(out.map((k) => k.keyword)).toEqual(["ai avatar", "video editor"]);
  });
  it("dedupes case-insensitively against the base, keeping the base entry", () => {
    const out = mergeFeatureKeywords([kw("Video Editor")], ["video editor", "new"]);
    expect(out.map((k) => k.keyword)).toEqual(["new", "Video Editor"]);
  });
  it("keeps features raw (lowercased) with zero competitor weight", () => {
    const [first] = mergeFeatureKeywords([], ["Montage Video"]);
    expect(first).toEqual({ keyword: "montage video", competitors: 0, occurrences: 0 });
  });
  it("returns the base unchanged when features is empty", () => {
    const base = [kw("a")];
    expect(mergeFeatureKeywords(base, [])).toEqual(base);
  });
});
