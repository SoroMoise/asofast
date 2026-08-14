import { describe, it, expect } from "vitest";

import { resolveLocaleWhatsNew, WHATS_NEW_MAX } from "./whats-new";

// Spy translator: records calls, returns a marked string so we can assert it ran.
function spy() {
  const calls: Array<[string, string]> = [];
  const translate = async (text: string, locale: string) => {
    calls.push([text, locale]);
    return `[${locale}] ${text}`;
  };
  return { calls, translate };
}

describe("resolveLocaleWhatsNew", () => {
  it("returns empty string for empty or whitespace source, without translating", async () => {
    const { calls, translate } = spy();
    expect(await resolveLocaleWhatsNew("", "en-US", "fr-FR", translate)).toBe("");
    expect(await resolveLocaleWhatsNew("   ", "en-US", "fr-FR", translate)).toBe("");
    expect(calls).toHaveLength(0);
  });

  it("uses verbatim (trimmed) source when the language subtag matches, without translating", async () => {
    const { calls, translate } = spy();
    expect(await resolveLocaleWhatsNew("  Bug fixes  ", "en-US", "en-GB", translate)).toBe(
      "Bug fixes"
    );
    expect(calls).toHaveLength(0);
  });

  it("translates when the language differs", async () => {
    const { calls, translate } = spy();
    const out = await resolveLocaleWhatsNew("Bug fixes", "en-US", "fr-FR", translate);
    expect(out).toBe("[fr-FR] Bug fixes");
    expect(calls).toEqual([["Bug fixes", "fr-FR"]]);
  });

  it("slices verbatim source to the max length", async () => {
    const { translate } = spy();
    const long = "x".repeat(WHATS_NEW_MAX + 500);
    const out = await resolveLocaleWhatsNew(long, "en-US", "en-US", translate);
    expect(out).toHaveLength(WHATS_NEW_MAX);
  });

  it("slices a translation longer than the max length", async () => {
    const translate = async () => "y".repeat(WHATS_NEW_MAX + 10);
    const out = await resolveLocaleWhatsNew("hi", "en-US", "fr-FR", translate);
    expect(out).toHaveLength(WHATS_NEW_MAX);
  });

  it("returns empty string when the translator throws, so publish skips whatsNew for that locale", async () => {
    const translate = async () => {
      throw new Error("openai 429");
    };
    const out = await resolveLocaleWhatsNew("Bug fixes", "en-US", "fr-FR", translate);
    expect(out).toBe("");
  });
});
