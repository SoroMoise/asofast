import { describe, expect, it } from "vitest";

import { formatUsageLog } from "./usage-log";

describe("formatUsageLog", () => {
  it("reports label, model, token counts and stop reason on one line", () => {
    const line = formatUsageLog({
      label: "extract_keywords",
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 1234,
        output_tokens: 567,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 20,
      },
      stopReason: "end_turn",
    });

    expect(line).toBe(
      "[usage anthropic] label=extract_keywords model=claude-sonnet-5 in=1234 out=567 cache_read=10 cache_write=20 stop=end_turn"
    );
  });

  it("counts absent cache fields as 0", () => {
    const line = formatUsageLog({
      label: "translate_keywords",
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 5,
        output_tokens: 6,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      },
      stopReason: "end_turn",
    });

    expect(line).toContain("cache_read=0 cache_write=0");
  });

  it("falls back to 'unlabeled' when the caller gave no label", () => {
    const line = formatUsageLog({
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      },
      stopReason: null,
    });

    expect(line).toContain("label=unlabeled");
    expect(line).toContain("stop=none");
  });

  it("makes a truncated answer visible through the stop reason", () => {
    const line = formatUsageLog({
      label: "generate_listing",
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 100,
        output_tokens: 8192,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      },
      stopReason: "max_tokens",
    });

    expect(line).toContain("out=8192");
    expect(line).toContain("stop=max_tokens");
  });
});
