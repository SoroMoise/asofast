import { describe, expect, it } from "vitest";

import type { ScreenshotStyle } from "@/lib/ai/types";

import { applyColorOverrides } from "./color-overrides";

// Fixture locale (avec dégradé) pour rester en import relatif pur, sans tirer la
// chaîne openai de style.ts. Le dégradé prouve qu'un override de fond le retire.
const BASE: ScreenshotStyle = {
  backgroundColor: "#4f46e5",
  backgroundGradientTo: "#7c3aed",
  textColor: "#ffffff",
  accentColor: "#ffffff",
  fontFamily: "Poppins",
  fontWeight: "bold",
  captionCase: "none",
  captionPlacement: "top",
  deviceFrame: true,
};

describe("applyColorOverrides", () => {
  it("overrides the background and drops the auto gradient (solid fill)", () => {
    const out = applyColorOverrides(BASE, { backgroundColor: "#123456" });
    expect(out.backgroundColor).toBe("#123456");
    expect(out.backgroundGradientTo).toBeNull();
    expect(out.textColor).toBe(BASE.textColor); // inchangé
  });

  it("overrides the headline text color", () => {
    const out = applyColorOverrides(BASE, { textColor: "#00ff00" });
    expect(out.textColor).toBe("#00ff00");
    expect(out.backgroundColor).toBe(BASE.backgroundColor); // inchangé
    expect(out.backgroundGradientTo).toBe(BASE.backgroundGradientTo);
  });

  it("applies both colors together", () => {
    const out = applyColorOverrides(BASE, { backgroundColor: "#000000", textColor: "#ffffff" });
    expect(out.backgroundColor).toBe("#000000");
    expect(out.backgroundGradientTo).toBeNull();
    expect(out.textColor).toBe("#ffffff");
  });

  it("keeps the computed style when overrides are null/undefined (auto mode)", () => {
    expect(applyColorOverrides(BASE, {})).toEqual(BASE);
    expect(applyColorOverrides(BASE, { backgroundColor: null, textColor: null })).toEqual(BASE);
  });

  it("ignores non-hex values instead of applying them", () => {
    const out = applyColorOverrides(BASE, {
      backgroundColor: "red",
      textColor: "#fff", // 3 chiffres: non conforme au format #rrggbb
    });
    expect(out).toEqual(BASE);
  });

  it("does not mutate the input style", () => {
    const before = { ...BASE };
    applyColorOverrides(BASE, { backgroundColor: "#abcdef" });
    expect(BASE).toEqual(before);
  });
});
