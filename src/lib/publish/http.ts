/**
 * I/O bornée pour le chemin de publication. En Node, `fetch` n'a AUCUN timeout
 * par défaut: une connexion qui stalle (API store, OAuth, téléchargement)
 * bloque l'action serveur indéfiniment (et en dev il n'y a pas de maxDuration
 * pour la couper). Ces helpers convertissent un appel bloqué en erreur claire
 * qui nomme l'étape, pour que la publication termine toujours.
 */

/** fetch avec délai maximum. Ne throw QUE sur timeout/échec réseau; le statut
 *  HTTP (res.ok) reste à la charge de l'appelant. `label` situe l'étape. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; label: string }
): Promise<Response> {
  const { timeoutMs = 30_000, label } = opts;
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const seconds = Math.round(timeoutMs / 1000);
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(`${label}: timed out (>${seconds}s), the call was interrupted.`);
    }
    throw new Error(`${label}: network error (${e instanceof Error ? e.message : "unknown"}).`);
  }
}

/**
 * GET idempotent -> octets, avec retry sur les échecs TRANSITOIRES.
 *
 * Un `fetchWithTimeout` nu suffisait tant qu'on supposait un stall rare. En
 * publication réelle (50 langues x 5 frames = 250 GET storage par run), un stall
 * >30s finit toujours par tomber: observé 3 runs de suite tués entre la 23e et
 * la 28e langue. Une seule frame calée ne doit pas coûter le run.
 *
 * La LECTURE DU CORPS est dans la boucle, pas seulement l'ouverture: le signal
 * d'`AbortSignal.timeout` couvre aussi le streaming du corps, donc un stall à
 * mi-téléchargement rejette sur `arrayBuffer()`, hors du try de
 * `fetchWithTimeout`, donc avec un DOMException brut et non étiqueté.
 *
 * Ne retente QUE ce qui peut réussir au coup d'après (timeout, coupure réseau,
 * 429, 5xx). Un 4xx est définitif (objet supprimé, URL signée expirée): on rend
 * `null` sans réessayer, ce que l'appelant traite comme frame ignorée.
 */
export async function fetchBytesWithRetry(
  url: string,
  opts: { timeoutMs?: number; label: string; attempts?: number }
): Promise<Buffer | null> {
  const { timeoutMs = 30_000, label, attempts = 3 } = opts;
  let last = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, {}, { timeoutMs, label });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      // 4xx (hors 429): définitif, inutile de brûler les tentatives restantes.
      if (res.status < 500 && res.status !== 429) return null;
      last = `HTTP ${res.status}`;
    } catch (e) {
      // `fetchWithTimeout` étiquette déjà; on retire le préfixe pour ne pas le
      // doubler dans le message final.
      const raw = e instanceof Error ? e.message : "unknown error";
      last = raw.startsWith(`${label}: `) ? raw.slice(label.length + 2) : raw;
    }
    // Backoff court: on vise le hoquet réseau, pas une panne longue.
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw new Error(`${label}: ${last} (${attempts} attempts).`);
}

/** Borne une promesse non-fetch (ex: google-auth). Rejette avec un message
 *  situé si elle dépasse `timeoutMs`. La promesse d'origine n'est pas annulable
 *  mais l'action cesse de l'attendre. */
export async function withTimeout<T>(
  promise: Promise<T>,
  opts: { timeoutMs?: number; label: string }
): Promise<T> {
  const { timeoutMs = 20_000, label } = opts;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label}: timed out (>${Math.round(timeoutMs / 1000)}s), the call was interrupted.`
              )
            ),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
