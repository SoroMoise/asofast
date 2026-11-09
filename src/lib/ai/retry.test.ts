import { describe, it, expect, vi } from "vitest";

import { isTransientNetworkError, withNetworkRetry } from "./retry";

const noSleep = async (_ms: number) => {};

describe("isTransientNetworkError", () => {
  it("detects SDK timeouts, DNS failures and 5xx", () => {
    expect(isTransientNetworkError(Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }))).toBe(true);
    expect(isTransientNetworkError(new Error("Connection error.", { cause: { code: "EAI_AGAIN" } }))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error("x"), { status: 503 }))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error("x"), { status: 429 }))).toBe(true);
  });
  it("ignores logical errors", () => {
    expect(isTransientNetworkError(new Error("DeepSeek output truncated"))).toBe(false);
    expect(isTransientNetworkError(Object.assign(new Error("bad"), { status: 400 }))).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
  });
});

describe("withNetworkRetry", () => {
  it("retries transient errors with growing delays then succeeds", async () => {
    const sleep = vi.fn(noSleep);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Request timed out."))
      .mockResolvedValueOnce("ok");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(withNetworkRetry(fn, { sleep, baseDelayMs: 100 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(80);
    warn.mockRestore();
  });
  it("gives up after `retries` and rethrows the last error", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("fetch failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(withNetworkRetry(fn, { sleep: noSleep, retries: 2 })).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
  it("does not retry non-network errors", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("invalid JSON"));
    await expect(withNetworkRetry(fn, { sleep: noSleep })).rejects.toThrow("invalid JSON");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
