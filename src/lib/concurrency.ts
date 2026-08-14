/** map() avec au plus `limit` promesses en vol (pool de workers). Préserve
 *  l'ordre des résultats. `fn` NE DOIT PAS throw si l'appelant veut traiter tous
 *  les items: le premier rejet fait échouer le Promise.all et abandonne les
 *  items restants (catch-and-return dans `fn` pour un traitement exhaustif). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    })
  );
  return results;
}
