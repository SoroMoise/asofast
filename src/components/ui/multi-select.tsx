"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type MultiSelectOption = { value: string; label: string };

/**
 * Liste déroulante à cases à cocher, compatible formulaires natifs: chaque
 * valeur cochée est soumise via un input hidden portant `name`.
 */
export function MultiSelect({
  name,
  options,
  placeholder = "Select…",
  emptyLabel = "No results",
  searchPlaceholder = "Search…",
  summaryFormatter = (count) => `${count} selected`,
  defaultSelected = [],
  onSelectionChange,
  onClose,
  id,
  className,
  disabled = false,
}: {
  name: string;
  options: MultiSelectOption[];
  placeholder?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  /** Résumé affiché quand plus de 2 valeurs sont cochées. */
  summaryFormatter?: (count: number) => string;
  defaultSelected?: string[];
  onSelectionChange?: (values: string[]) => void;
  /**
   * Appelé chaque fois que le menu se ferme (clic dehors, Escape, toggle), avec
   * la sélection courante en argument (source de vérité, jamais périmée).
   */
  onClose?: (values: string[]) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>(() =>
    defaultSelected.filter((v) => options.some((o) => o.value === v))
  );
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Valeurs courantes tenues dans un ref, mises à jour en render: onClose doit
  // passer la sélection fraîche du composant, pas le miroir du parent qui suit
  // avec un frame de retard (sinon un save à la fermeture lit un état périmé).
  // Sûr ici: ce ref n'est lu que dans onClose (jamais pendant le render).
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;

  // Notifie le parent APRÈS le commit, jamais dans l'updater de setState: appeler
  // onSelectionChange pendant le render déclenche un setState du parent en plein
  // render (warning React "Cannot update a component while rendering another").
  const onChangeRef = React.useRef(onSelectionChange);
  React.useEffect(() => {
    onChangeRef.current = onSelectionChange;
  });
  React.useEffect(() => {
    onChangeRef.current?.(selected);
  }, [selected]);

  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // Focus: la recherche à l'ouverture, retour au déclencheur sur Escape.
  React.useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // onClose au front descendant de `open` (fermeture réelle), sans re-déclencher
  // si l'identité du callback change entre deux rendus.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });
  const prevOpen = React.useRef(open);
  React.useEffect(() => {
    if (prevOpen.current && !open) onCloseRef.current?.(selectedRef.current);
    prevOpen.current = open;
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (value: string) =>
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );

  const filtered = query.trim()
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.trim().toLowerCase()) ||
          o.value.toLowerCase().includes(query.trim().toLowerCase())
      )
    : options;

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? options
            .filter((o) => selected.includes(o.value))
            .map((o) => o.label)
            .join(", ")
        : summaryFormatter(selected.length);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {selected.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          selected.length === 0 && "text-muted-foreground"
        )}
      >
        <span className="truncate text-left">{summary}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={cn("ml-2 h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-md">
          <div className="border-b p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 w-full rounded-sm border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <ul role="listbox" aria-multiselectable className="max-h-60 overflow-y-auto p-1">
            {!query.trim() && options.length > 1 ? (
              <li className="border-b pb-1 mb-1">
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selected.length === options.length}
                    onChange={() =>
                      setSelected(
                        selected.length === options.length
                          ? []
                          : options.map((o) => o.value)
                      )
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="flex-1">Select all</span>
                  <span className="text-xs text-muted-foreground">{options.length}</span>
                </label>
              </li>
            ) : null}
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</li>
            ) : (
              filtered.map((option) => (
                <li key={option.value} role="option" aria-selected={selected.includes(option.value)}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={selected.includes(option.value)}
                      onChange={() => toggle(option.value)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="flex-1">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.value}</span>
                  </label>
                </li>
              ))
            )}
          </ul>
          <div className="flex items-center justify-between border-t px-2 py-1.5">
            <span className="text-xs text-muted-foreground">
              {selected.length}/{options.length}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelected(options.map((o) => o.value))}
                className="text-xs font-medium text-primary hover:underline"
              >
                Select all
              </button>
              {selected.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="text-xs font-medium text-muted-foreground hover:underline"
                >
                  Clear all
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
