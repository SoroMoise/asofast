/**
 * Aucun chiffrement nécessaire : en local, le fichier SQLite est sur la même
 * machine que tout le reste. Les credentials stores (App Store Connect, Google
 * Play) sont stockés en clair dans la base.
 *
 * Ces fonctions existent pour compatibilité avec le code existant.
 */

export function encryptJSON(value: unknown): string {
  return JSON.stringify(value);
}

export function decryptJSON<T = unknown>(payload: string): T {
  return JSON.parse(payload) as T;
}