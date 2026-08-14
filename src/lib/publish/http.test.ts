import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBytesWithRetry } from "./http";

/** Réponse minimale suffisante pour `fetchBytesWithRetry`. */
function response(status: number, body = "png-bytes"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

/** Le rejet exact d'`AbortSignal.timeout` tel que `fetch` le propage. */
function timeoutError(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

const OPTS = { label: "Downloading screenshot 3", timeoutMs: 1_000 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchBytesWithRetry", () => {
  // Régression: un stall >30s du storage sur UNE frame faisait throw
  // `downloadFrameUrls`, ce qui remontait jusqu'au client et abandonnait toutes
  // les langues restantes. Observé 3 runs de suite tués entre la 23e et la 28e
  // langue sur 50. Le GET est idempotent: il doit être retenté.
  it("retries a timed-out download and succeeds on a later attempt (the bug)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetchMock);

    const bytes = await fetchBytesWithRetry("https://storage/01.jpg", OPTS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bytes?.toString()).toBe("png-bytes");
  });

  it("retries a stall that hits while the body is being read", async () => {
    // Le signal d'AbortSignal.timeout couvre AUSSI le streaming du corps: le
    // rejet tombe alors sur arrayBuffer(), pas sur fetch(). Si la lecture du
    // corps était hors de la boucle, ce cas ne serait jamais retenté.
    const stalledBody = {
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        throw timeoutError();
      },
    } as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stalledBody)
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetchMock);

    const bytes = await fetchBytesWithRetry("https://storage/01.jpg", OPTS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bytes?.toString()).toBe("png-bytes");
  });

  it("retries 429 and 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBytesWithRetry("https://storage/01.jpg", OPTS)).resolves.not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a 4xx and skips the frame", async () => {
    // Objet supprimé / URL signée expirée: définitif. Brûler les tentatives
    // rallongerait chaque langue pour rien.
    const fetchMock = vi.fn().mockResolvedValue(response(404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBytesWithRetry("https://storage/01.jpg", OPTS)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a labelled error naming the step once the attempts are exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError()));

    await expect(fetchBytesWithRetry("https://storage/01.jpg", OPTS)).rejects.toThrow(
      /^Downloading screenshot 3: timed out \(>1s\), the call was interrupted\. \(3 attempts\)\.$/
    );
  });

  it("stops after `attempts` tries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(timeoutError());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchBytesWithRetry("https://storage/01.jpg", { ...OPTS, attempts: 2 })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
