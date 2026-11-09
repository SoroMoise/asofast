import { describe, expect, it } from "vitest";

import {
  containsUrl,
  missingLegalLines,
  relativeToBase,
  resolveLegalUrl,
} from "./legal-links";

describe("resolveLegalUrl", () => {
  it("joins a path to the base, whatever the slashes", () => {
    expect(resolveLegalUrl("https://site.com", "/privacy")).toBe("https://site.com/privacy");
    expect(resolveLegalUrl("https://site.com/", "privacy")).toBe("https://site.com/privacy");
    expect(resolveLegalUrl("https://site.com/app/", "/terms.html")).toBe(
      "https://site.com/app/terms.html"
    );
  });

  it("keeps a full URL as-is, even on another domain", () => {
    expect(resolveLegalUrl("https://site.com", "https://legal.other.com/p")).toBe(
      "https://legal.other.com/p"
    );
  });

  it("returns empty for no value, or a path without base", () => {
    expect(resolveLegalUrl("https://site.com", "  ")).toBe("");
    expect(resolveLegalUrl("", "/privacy")).toBe("");
  });
});

describe("relativeToBase", () => {
  it("shows the path under the base, the full URL otherwise", () => {
    expect(relativeToBase("https://site.com/", "https://site.com/privacy")).toBe("/privacy");
    expect(relativeToBase("https://site.com", "https://other.com/privacy")).toBe(
      "https://other.com/privacy"
    );
    expect(relativeToBase("", "https://site.com/privacy")).toBe("https://site.com/privacy");
  });
});

describe("containsUrl", () => {
  it("does not match a URL that is only a prefix of another", () => {
    expect(containsUrl("Privacy: https://site.com/privacy", "https://site.com")).toBe(false);
    expect(containsUrl("Docs: https://site.com.evil.io", "https://site.com")).toBe(false);
  });

  it("matches at end of text, before a space, slash or final period", () => {
    expect(containsUrl("Site: https://site.com", "https://site.com")).toBe(true);
    expect(containsUrl("Visit https://site.com/ today", "https://site.com")).toBe(true);
    expect(containsUrl("Visit https://site.com.", "https://site.com/")).toBe(true);
  });
});

describe("missingLegalLines", () => {
  it("falls back on English labels when the translated one is empty", () => {
    expect(
      missingLegalLines("", { websiteUrl: "https://s.com" }, { website: "  " })
    ).toEqual(["Website: https://s.com"]);
  });

  it("uses translated labels and skips a duplicate link", () => {
    expect(
      missingLegalLines(
        "",
        {
          websiteUrl: "https://s.com/",
          privacyPolicyUrl: "https://s.com/privacy",
          termsUrl: "https://s.com/privacy",
        },
        { website: "Site web", privacy: "Politique de confidentialité" }
      )
    ).toEqual(["Site web: https://s.com", "Politique de confidentialité: https://s.com/privacy"]);
  });
});
