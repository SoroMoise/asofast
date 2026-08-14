import { describe, it, expect, vi } from "vitest";

// Importing ./prompts pulls in getPrompt from db; mock it so the
// module loads without depending on the DB. renderTemplate itself is pure.
vi.mock("@/lib/db", () => ({
  getPrompt: () => {
    throw new Error("no db in tests");
  },
}));

import { renderTemplate } from "./prompts";

describe("renderTemplate", () => {
  it("substitutes {{var}} and leaves unknown vars empty", () => {
    expect(renderTemplate("Hi {{name}}, {{missing}}!", { name: "Al" })).toBe("Hi Al, !");
  });

  it("keeps a {{#if}} body when the variable is a non-empty string", () => {
    expect(renderTemplate("a{{#if p}}B{{/if}}c", { p: "1" })).toBe("aBc");
  });

  it("drops a {{#if}} body when the variable is empty or absent", () => {
    expect(renderTemplate("a{{#if p}}B{{/if}}c", { p: "" })).toBe("ac");
    expect(renderTemplate("a{{#if p}}B{{/if}}c", {})).toBe("ac");
  });

  it("resolves {{var}} inside a kept {{#if}} body", () => {
    expect(renderTemplate("{{#if p}}x={{x}}{{/if}}", { p: "1", x: "9" })).toBe("x=9");
  });

  it("handles multiple independent {{#if}} blocks without merging (non-greedy)", () => {
    const t = "{{#if a}}A{{/if}}-{{#if b}}B{{/if}}";
    expect(renderTemplate(t, { a: "1", b: "" })).toBe("A-");
    expect(renderTemplate(t, { a: "", b: "1" })).toBe("-B");
  });

  it("spans newlines inside a block (the privacy-line pattern)", () => {
    expect(renderTemplate("x\n{{#if p}}line\n{{/if}}y", { p: "1" })).toBe("x\nline\ny");
    expect(renderTemplate("x\n{{#if p}}line\n{{/if}}y", { p: "" })).toBe("x\ny");
  });
});
