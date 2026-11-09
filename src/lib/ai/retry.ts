/**
 * Retries applicatifs pour les appels LLM, en plus des retries du SDK.
 *
 * Pourquoi en plus: le SDK OpenAI (utilisé aussi pour DeepSeek) réessaie vite
 * (backoff de 0,5 s à 8 s). Une coupure DNS (EAI_AGAIN) ou une connexion lente
 * dure souvent plus longtemps que cette fenêtre. On réessaie donc encore
 * quelques fois, avec un backoff plus long, mais UNIQUEMENT sur les erreurs
 * réseau / timeout / 408 / 429 / 5xx. Une erreur « logique » (JSON invalide,
 * sortie tronquée, réponse vide) n'est pas retentée ici.
 */

const TRANSIENT_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "AbortError",
  "TimeoutError",
  "ConnectTimeoutError",
]);

const TRANSIENT_MESSAGE =
  /timed? ?out|timeout|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|network error|connection error/i;

/** Vrai si l'erreur (ou une de ses causes) ressemble à un incident réseau passager. */
export function isTransientNetworkError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (typeof e.name === "string" && TRANSIENT_NAMES.has(e.name)) return true;
  if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) return true;
  if (typeof e.status === "number" && (e.status === 408 || e.status === 429 || e.status >= 500)) {
    return true;
  }
  if (typeof e.message === "string" && TRANSIENT_MESSAGE.test(e.message)) return true;
  return isTransientNetworkError(e.cause, depth + 1);
}

export type RetryOptions = {
  /** Nombre de nouvelles tentatives après la première (défaut 2 → 3 essais). */
  retries?: number;
  /** Délai avant la 1re nouvelle tentative; triplé à chaque essai (défaut 4 s). */
  baseDelayMs?: number;
  /** Libellé pour les logs. */
  label?: string;
  /** Injectable pour les tests. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Exécute `fn` et la relance sur erreur réseau passagère (backoff ×3 + jitter
 * ±20 %). Toute autre erreur, ou la dernière erreur réseau, est relancée telle
 * quelle à l'appelant.
 */
export async function withNetworkRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 4_000;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransientNetworkError(err)) throw err;
      const delay = Math.round(base * 3 ** attempt * (0.8 + Math.random() * 0.4));
      console.warn(
        `[retry] ${opts.label ?? "call"}: transient network error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay} ms`,
        err instanceof Error ? err.message : err
      );
      await sleep(delay);
    }
  }
}
