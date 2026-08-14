"use client";

import * as React from "react";

import { IconX } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { storeIconUrl } from "@/lib/store-icons";
import type { StorePlatform } from "@/types";

export type AppRef = {
  store: StorePlatform;
  identifier: string;
  name: string;
  developer: string | null;
  icon: string | null;
};

/** Détecte un identifiant collé: App ID numérique iOS ou package name Android. */
function looksLikeIdentifier(store: StorePlatform, q: string): boolean {
  return store === "appstore" ? /^\d+$/.test(q) : /^[\w.]+\.[\w.]+$/.test(q);
}

export function AppChip({
  app,
  onRemove,
  removeDisabled,
}: {
  app: AppRef;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  return (
    // Fond teinté sans bordure: pas de carte dans la carte.
    <div className="flex items-center gap-3 rounded-md bg-muted/60 px-3 py-2">
      {app.icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- icônes stores externes, domaines multiples
        <img src={storeIconUrl(app.icon)} alt="" className="h-10 w-10 rounded-lg" />
      ) : (
        <div className="h-10 w-10 rounded-lg bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{app.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {app.developer ?? app.identifier}
        </p>
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          aria-label={`Remove ${app.name}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconX />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Recherche d'app par nom (autocomplete) ou identifiant collé (app id numérique
 * iOS / package name Android). Appelle onAdd avec l'app choisie.
 */
export function AppSearchInput({
  store,
  excludeIdentifiers = [],
  onAdd,
  onError,
  disabled,
  id,
  placeholder,
}: {
  store: StorePlatform;
  excludeIdentifiers?: string[];
  onAdd: (app: AppRef) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<AppRef[]>([]);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const q = query.trim();
      setSearching(true);
      try {
        // Identifiant collé (App ID / package name): les recherches stores ne les
        // matchent pas, on résout donc l'app en parallèle via /api/apps/lookup.
        const [searchData, lookupData] = await Promise.all([
          fetch(`/api/apps/search?store=${store}&q=${encodeURIComponent(q)}`)
            .then((res) => res.json() as Promise<{ results?: AppRef[] }>)
            .catch(() => ({ results: [] as AppRef[] })),
          looksLikeIdentifier(store, q)
            ? fetch(`/api/apps/lookup?store=${store}&identifier=${encodeURIComponent(q)}`)
                .then((res) =>
                  res.ok ? (res.json() as Promise<{ app?: AppRef }>) : { app: undefined }
                )
                .catch(() => ({ app: undefined }))
            : Promise.resolve({ app: undefined as AppRef | undefined }),
        ]);
        const lookup = lookupData.app ?? null;
        const combined = [
          ...(lookup ? [lookup] : []),
          ...(searchData.results ?? []).filter((r) => r.identifier !== lookup?.identifier),
        ];
        setResults(combined.filter((r) => !excludeIdentifiers.includes(r.identifier)));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- excludeIdentifiers par valeur
  }, [query, store, excludeIdentifiers.join(",")]);

  function pick(app: AppRef) {
    onAdd(app);
    setQuery("");
    setResults([]);
  }

  async function addById() {
    const identifier = query.trim();
    if (!identifier) return;
    if (excludeIdentifiers.includes(identifier)) {
      onError?.("This app is already used on this project.");
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/apps/lookup?store=${store}&identifier=${encodeURIComponent(identifier)}`
      );
      const data = (await res.json()) as { app?: AppRef; error?: string };
      if (!res.ok || !data.app) throw new Error(data.error ?? "App not found.");
      if (excludeIdentifiers.includes(data.app.identifier)) {
        onError?.("This app is already used on this project.");
        return;
      }
      pick(data.app);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "App not found.");
    } finally {
      setSearching(false);
    }
  }

  const looksLikeId = looksLikeIdentifier(store, query.trim());
  // L'app collée par identifiant a déjà été résolue et figure dans les résultats.
  const identifierResolved = results.some((r) => r.identifier === query.trim());

  return (
    <div className="relative">
      <Input
        id={id}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        placeholder={
          placeholder ??
          `App name, ${store === "appstore" ? "or App ID" : "or package name"}…`
        }
        className={searching ? "pr-9" : undefined}
      />
      {searching ? (
        <Spinner className="absolute right-3 top-3 text-muted-foreground" />
      ) : null}
      {query.trim().length >= 2 && (results.length > 0 || looksLikeId || searching) ? (
        <div className="absolute z-40 mt-1 w-full rounded-md border bg-background shadow-md">
          {searching ? (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Spinner className="h-3.5 w-3.5" /> Searching…
            </p>
          ) : null}
          {results.map((r) => (
            <button
              key={r.identifier}
              type="button"
              onClick={() => pick(r)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
            >
              {r.icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- icônes stores externes
                <img src={storeIconUrl(r.icon)} alt="" className="h-8 w-8 rounded-md" />
              ) : (
                <div className="h-8 w-8 rounded-md bg-muted" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.developer ?? r.identifier}
                </span>
              </span>
            </button>
          ))}
          {!searching && looksLikeId && !identifierResolved ? (
            <button
              type="button"
              onClick={addById}
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-primary hover:bg-muted"
            >
              Add by identifier: {query.trim()}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
