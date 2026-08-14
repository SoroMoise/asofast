/**
 * Sémaphore d'accès concurrent GLOBAL pour un lot de publication. Les pools
 * imbriqués (langues × images) multiplient les requêtes en vol: 4 langues × 8
 * images = 32 uploads concurrents vers Google → 429 → retries → lent. Ce gate
 * borne le nombre TOTAL de requêtes Google réellement en vol, quel que soit le
 * niveau qui les émet. Toutes les requêtes Google d'un lot passent par run().
 */
export type Gate = { run: <T>(fn: () => Promise<T>) => Promise<T> };

export function createGate(max: number): Gate {
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < max) {
        active++;
        resolve();
      } else {
        waiters.push(() => {
          active++;
          resolve();
        });
      }
    });

  const release = (): void => {
    active--;
    const next = waiters.shift();
    if (next) next();
  };

  return {
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
