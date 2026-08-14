export function storeIconUrl(url: string): string;
export function storeIconUrl(url: null): null;
export function storeIconUrl(url: string | null): string | null {
  if (!url) return null;
  return `/api/apps/icon?url=${encodeURIComponent(url)}`;
}
