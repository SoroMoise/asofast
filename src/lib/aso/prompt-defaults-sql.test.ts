import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { DEFAULTS } from "./prompt-defaults";

// The prompts live in two places that must not drift: the embedded DEFAULTS
// (runtime fallback) and the 0019 SQL seed (the editable DB rows). This locks
// them together. aso_extract_keywords is excluded: 0009 seeds it (in French)
// and 0019 does not touch it. aso_translate_feature_graphic came after 0019 and
// only exists as an embedded default.
const NOT_IN_0019 = new Set(["aso_extract_keywords", "aso_translate_feature_graphic"]);
const SEEDED = Object.keys(DEFAULTS).filter((k) => !NOT_IN_0019.has(k));
const sql = readFileSync("db/migrations/0019_prompts_seed_all.sql", "utf8");
const sqlEscape = (s: string) => s.replaceAll("'", "''");

describe("0019 SQL seed matches embedded DEFAULTS", () => {
  it("seeds all ten migrated keys", () => {
    expect(SEEDED).toHaveLength(10);
    for (const key of SEEDED) expect(sql).toContain(`'${key}',`);
  });

  it.each(SEEDED)("%s: system + user text is byte-identical (SQL-escaped)", (key) => {
    expect(sql).toContain(sqlEscape(DEFAULTS[key].system));
    expect(sql).toContain(sqlEscape(DEFAULTS[key].user));
  });

  it("does not re-seed aso_extract_keywords (0009 owns it)", () => {
    expect(sql).not.toContain("'aso_extract_keywords'");
  });
});
