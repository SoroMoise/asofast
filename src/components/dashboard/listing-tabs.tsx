"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  deleteListing,
  deleteScreenshots,
  generateAso,
  generateProjectScreenshots,
  reorderScreenshots,
  saveListing,
  saveScreenshotCaptions,
} from "@/app/(app)/actions";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { SortableItem, SortableList } from "@/components/dashboard/sortable";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconAlertBadge, IconGrip, IconX } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { STORE_LIMITS } from "@/lib/aso/limits";
import { STORE_LOCALES } from "@/lib/locales";
import { WHATS_NEW_MAX } from "@/lib/publish/whats-new";
import { cn } from "@/lib/utils";
import type { Listing, StorePlatform } from "@/types";

type KeywordEntry = { keyword: string; competitors: number; occurrences: number };
type ScreenshotFrame = { url: string; caption: string; sourcePath: string };

function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}>
      {value.length}/{max}
    </span>
  );
}

function localeLabel(store: StorePlatform, code: string): string {
  return STORE_LOCALES[store].find((l) => l.value === code)?.label ?? code;
}

/**
 * Éléments manquants d'une fiche pour qu'elle soit publiable: mêmes champs que
 * le formulaire éditable (selon le store) + screenshots. Le téléphone est
 * toujours requis (livrable principal); la tablette seulement si le projet
 * cible la tablette (captures sources tablette uploadées). Une liste non vide =
 * langue incomplète (pastille rouge sur l'onglet).
 */
function listingIssues(
  listing: Listing,
  store: StorePlatform,
  usesTablet: boolean
): string[] {
  const issues: string[] = [];
  const empty = (v: unknown) => String(v ?? "").trim() === "";
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

  if (empty(listing.title)) issues.push("Title");
  if (store === "appstore") {
    if (empty(listing.subtitle)) issues.push("Subtitle");
    if (empty(listing.description)) issues.push("Description");
    if (empty(listing.keywords)) issues.push("Keywords field");
  } else {
    if (empty(listing.short_description)) issues.push("Short description");
    if (empty(listing.description)) issues.push("Long description");
  }
  if (count(listing.screenshots) === 0) issues.push("Phone screenshots");
  if (usesTablet && count(listing.screenshots_tablet) === 0) {
    issues.push(store === "appstore" ? "iPad screenshots" : "Tablet screenshots");
  }
  return issues;
}

// Tri alphabétique des onglets: collation FR (accents corrects: É≈E, à≈a) et
// insensible à la casse, pour un ordre stable quel que soit l'ordre d'ajout.
const LABEL_COLLATOR = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export function ListingTabs({
  projectId,
  store,
  targetLocales,
  listings,
  usesTablet,
  hasSourceScreenshots,
  whatsNewSource,
}: {
  projectId: string;
  store: StorePlatform;
  targetLocales: string[];
  listings: Listing[];
  /** Source What's New du projet (langue source). Non vide + App Store => le
   *  champ traduit éditable s'affiche par langue dans chaque onglet. */
  whatsNewSource: string;
  /** Le projet cible la tablette (captures sources tablette présentes): alors
   *  les screenshots tablette manquants comptent comme fiche incomplète. */
  usesTablet: boolean;
  /** Des captures sources étaient uploadées au chargement: la génération des
   *  screenshots d'une langue est possible sans repasser par le CTA principal.
   *  Repli quand la carte Screenshots ne publie pas de compte live. */
  hasSourceScreenshots: boolean;
}) {
  const router = useRouter();
  const byLocale = React.useMemo(
    () => new Map(listings.map((l) => [l.locale, l])),
    [listings]
  );
  // Onglets: seules les langues déjà générées (listing existant) s'affichent,
  // triées par ordre alphabétique du libellé. Une langue cible ajoutée mais pas
  // encore générée n'apparaît pas ici — elle se génère via le CTA principal
  // « Générer fiches + screenshots ».
  const tabs = React.useMemo(
    () =>
      listings
        .map((l) => l.locale)
        .sort((a, b) => LABEL_COLLATOR.compare(localeLabel(store, a), localeLabel(store, b))),
    [store, listings]
  );

  const [active, setActive] = React.useState(tabs[0] ?? "");
  // Si l'onglet actif disparaît (fiche supprimée, ou liste rechargée), bascule
  // sur le premier onglet disponible.
  React.useEffect(() => {
    if (tabs.length > 0 && !tabs.includes(active)) setActive(tabs[0]);
  }, [tabs, active]);
  const listing = byLocale.get(active) ?? null;
  // Roving tabindex: focus déplacé avec les flèches dans la liste d'onglets.
  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const [form, setForm] = React.useState({
    title: "",
    subtitle: "",
    short_description: "",
    description: "",
    keywords: "",
    whats_new: "",
  });
  React.useEffect(() => {
    setForm({
      title: listing?.title ?? "",
      subtitle: listing?.subtitle ?? "",
      short_description: listing?.short_description ?? "",
      description: listing?.description ?? "",
      keywords: listing?.keywords ?? "",
      whats_new: listing?.whats_new ?? "",
    });
  }, [listing]);
  // Champ What's New affiché seulement quand une source existe (App Store): la
  // valeur par langue vit dans listing.whats_new (traduite au save de la carte
  // source / à la génération), éditable ici.
  const showWhatsNew = store === "appstore" && whatsNewSource.trim() !== "";

  const [saving, setSaving] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const [generatingShots, setGeneratingShots] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmRegen, setConfirmRegen] = React.useState(false);
  // Suppression des screenshots générés d'un device (téléphone/tablette) pour la
  // langue courante. Confirmation 2 clics comme les autres actions destructives.
  const [deletingShots, setDeletingShots] = React.useState<"phone" | "tablet" | null>(null);
  const [confirmDeleteShots, setConfirmDeleteShots] = React.useState<"phone" | "tablet" | null>(
    null
  );
  const [feedback, setFeedback] = React.useState<{ error?: string; message?: string }>({});
  React.useEffect(() => {
    setConfirmDelete(false);
    setConfirmRegen(false);
    setConfirmDeleteShots(null);
  }, [active]);

  // Base de mots clés éditable (chips): ajout/suppression par l'utilisateur.
  // Réinitialisée quand on change de fiche. Sert d'entrée à la régénération.
  const initialKeywords = React.useMemo<KeywordEntry[]>(
    () =>
      Array.isArray(listing?.keyword_base)
        ? (listing.keyword_base as unknown as KeywordEntry[])
        : [],
    [listing]
  );
  const [keywords, setKeywords] = React.useState<KeywordEntry[]>(initialKeywords);
  const [newKeyword, setNewKeyword] = React.useState("");
  React.useEffect(() => {
    setKeywords(initialKeywords);
    setNewKeyword("");
  }, [initialKeywords]);

  const keywordsDirty =
    JSON.stringify(keywords.map((k) => k.keyword)) !==
    JSON.stringify(initialKeywords.map((k) => k.keyword));

  const formDirty =
    keywordsDirty ||
    form.title !== (listing?.title ?? "") ||
    form.subtitle !== (listing?.subtitle ?? "") ||
    form.short_description !== (listing?.short_description ?? "") ||
    form.description !== (listing?.description ?? "") ||
    form.keywords !== (listing?.keywords ?? "") ||
    (showWhatsNew && form.whats_new !== (listing?.whats_new ?? ""));

  function addKeyword() {
    const kw = newKeyword.trim();
    if (!kw) return;
    if (keywords.some((k) => k.keyword.toLowerCase() === kw.toLowerCase())) {
      setNewKeyword("");
      return;
    }
    setKeywords((prev) => [...prev, { keyword: kw, competitors: 0, occurrences: 0 }]);
    setNewKeyword("");
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k.keyword !== kw));
  }
  const serverFrames = React.useMemo<ScreenshotFrame[]>(
    () =>
      Array.isArray(listing?.screenshots)
        ? (listing.screenshots as unknown as ScreenshotFrame[])
        : [],
    [listing]
  );
  const serverTabletFrames = React.useMemo<ScreenshotFrame[]>(
    () =>
      Array.isArray(listing?.screenshots_tablet)
        ? (listing.screenshots_tablet as unknown as ScreenshotFrame[])
        : [],
    [listing]
  );
  // Ordre client des screenshots (partagé toutes langues): override par-dessus
  // l'ordre serveur, appliqué à chaque locale. Persiste au changement d'onglet
  // sans router.refresh (n'écrase pas les captions en cours d'édition).
  const [order, setOrder] = React.useState<string[] | null>(null);
  const [orderTablet, setOrderTablet] = React.useState<string[] | null>(null);
  const [reordering, setReordering] = React.useState(false);

  const sortFrames = React.useCallback(
    (list: ScreenshotFrame[], ord: string[] | null): ScreenshotFrame[] => {
      if (!ord) return list;
      const rank = new Map(ord.map((p, i) => [p, i]));
      return list
        .map((f, i) => ({ f, i }))
        .sort((a, b) => {
          const ra = rank.get(a.f.sourcePath);
          const rb = rank.get(b.f.sourcePath);
          if (ra != null && rb != null) return ra - rb;
          if (ra != null) return -1;
          if (rb != null) return 1;
          return a.i - b.i;
        })
        .map((x) => x.f);
    },
    []
  );

  const frames = sortFrames(serverFrames, order);
  const tabletFrames = sortFrames(serverTabletFrames, orderTablet);

  const [captionEdits, setCaptionEdits] = React.useState<Record<string, string>>({});
  const [captionEditsTablet, setCaptionEditsTablet] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    setCaptionEdits({});
    setCaptionEditsTablet({});
  }, [listing]);
  const [rerendering, setRerendering] = React.useState<"phone" | "tablet" | null>(null);

  const captionsDirty = frames.some(
    (f) => captionEdits[f.sourcePath] !== undefined && captionEdits[f.sourcePath] !== f.caption
  );
  const tabletCaptionsDirty = tabletFrames.some(
    (f) =>
      captionEditsTablet[f.sourcePath] !== undefined &&
      captionEditsTablet[f.sourcePath] !== f.caption
  );

  // pageBusy = génération/publication en cours (verrou global): fige alors
  // toute la carte. Les actions propres à cette carte (save, régénération,
  // suppression, re-render) ne lèvent pas ce verrou: leur état local ne fige
  // que cette carte, pas les autres.
  const { busy: pageBusy, sourceShotCount } = useProjectBusy();
  // Captures effectives = compte LIVE de la carte Screenshots si montée, sinon
  // le compte serveur. Un upload en cours de session fait apparaître le bouton
  // sans recharger la page (l'upload est client, sans router.refresh).
  const hasShots = sourceShotCount !== null ? sourceShotCount > 0 : hasSourceScreenshots;
  const busy =
    saving ||
    regenerating ||
    generatingShots ||
    deleting ||
    deletingShots !== null ||
    rerendering !== null ||
    reordering ||
    pageBusy;

  async function handleReorderFrames(device: "phone" | "tablet", newIds: string[]) {
    const setOrd = device === "tablet" ? setOrderTablet : setOrder;
    const prevOrd = device === "tablet" ? orderTablet : order;
    setOrd(newIds);
    setReordering(true);
    setFeedback({});
    try {
      const res = await reorderScreenshots({ projectId, device, order: newIds });
      if (res.error) {
        setOrd(prevOrd);
        setFeedback({ error: res.error });
      } else {
        setFeedback({ message: "Order saved." });
      }
    } finally {
      setReordering(false);
    }
  }

  async function handleRerenderCaptions(device: "phone" | "tablet") {
    const list = device === "tablet" ? tabletFrames : frames;
    const edits = device === "tablet" ? captionEditsTablet : captionEdits;
    setRerendering(device);
    setFeedback({});
    try {
      const res = await saveScreenshotCaptions({
        projectId,
        locale: active,
        device,
        captions: list.map((f) => ({
          sourcePath: f.sourcePath,
          caption: edits[f.sourcePath] ?? f.caption,
        })),
      });
      setFeedback(
        res.error ? { error: res.error } : { message: "Screenshots re-rendered." }
      );
      if (!res.error) router.refresh();
    } finally {
      setRerendering(null);
    }
  }

  /** Génère les screenshots de la seule langue active, sans toucher au texte de
   *  la fiche (le CTA principal ferait les deux, pour toutes les langues). */
  async function handleGenerateScreenshots() {
    setGeneratingShots(true);
    setFeedback({});
    try {
      const res = await generateProjectScreenshots({ projectId, locales: [active] });
      if (res.error) {
        setFeedback({ error: res.error });
      } else if (res.failed.length > 0) {
        setFeedback({ error: `${active}: ${res.failed[0].error}` });
      } else {
        setFeedback({ message: "Screenshots generated." });
        setOrder(null);
        setOrderTablet(null);
        router.refresh();
      }
    } finally {
      setGeneratingShots(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setFeedback({});
    try {
      const res = await saveListing({
        projectId,
        locale: active,
        title: form.title,
        subtitle: form.subtitle,
        shortDescription: form.short_description,
        description: form.description,
        keywords: form.keywords,
        keywordBase: keywords,
        // Non fourni quand le champ n'est pas affiché: n'écrase pas la colonne.
        whatsNew: showWhatsNew ? form.whats_new : undefined,
      });
      setFeedback(res.error ? { error: res.error } : { message: "Listing saved." });
      if (!res.error) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setFeedback({});
    try {
      const res = await deleteListing({ projectId, locale: active });
      if (res.error) {
        setFeedback({ error: res.error });
      } else {
        setFeedback({ message: "Listing deleted." });
        router.refresh();
      }
    } finally {
      setConfirmDelete(false);
      setDeleting(false);
    }
  }

  async function handleDeleteScreenshots(device: "phone" | "tablet") {
    if (confirmDeleteShots !== device) {
      setConfirmDeleteShots(device);
      return;
    }
    setConfirmDeleteShots(null);
    setDeletingShots(device);
    setFeedback({});
    try {
      const res = await deleteScreenshots({ projectId, locale: active, device });
      if (res.error) {
        setFeedback({ error: res.error });
      } else {
        // L'override d'ordre client référençait les frames supprimées: on le
        // remet à l'ordre serveur pour ce device.
        if (device === "tablet") setOrderTablet(null);
        else setOrder(null);
        setFeedback({
          message:
            device === "tablet" ? "Tablet screenshots deleted." : "Screenshots deleted.",
        });
        router.refresh();
      }
    } finally {
      setDeletingShots(null);
    }
  }

  async function handleRegenerate() {
    // Écrase la fiche (y compris éditée à la main): même confirmation 2 clics
    // que la suppression.
    if (listing && !confirmRegen) {
      setConfirmRegen(true);
      return;
    }
    setConfirmRegen(false);
    setRegenerating(true);
    setFeedback({});
    try {
      // Régénère avec la liste de mots clés éditée (utilisée telle quelle).
      const res = await generateAso({ projectId, locales: [active], keywords });
      if (res.error) {
        setFeedback({ error: res.error });
      } else if (res.failed.length > 0) {
        setFeedback({ error: `${active}: ${res.failed[0].error}` });
      } else {
        setFeedback({ message: "Listing regenerated." });
        setOrder(null);
        setOrderTablet(null);
        router.refresh();
      }
    } finally {
      setRegenerating(false);
    }
  }

  if (tabs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Generated listings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {targetLocales.length === 0
              ? "No target language on this project."
              : "No listing generated yet. Use the “Generate” button above."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generated listings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Onglets langues: sélection en indigo (Règle Ignition), état "à
            générer" en badge texte (jamais par opacité ou tooltip seuls). */}
        <div
          className="flex flex-wrap gap-1 border-b pb-2"
          role="tablist"
          aria-label="Listing languages"
          onKeyDown={(e) => {
            const idx = tabs.indexOf(active);
            let next: number | null = null;
            if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
            else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = tabs.length - 1;
            if (next === null) return;
            e.preventDefault();
            const code = tabs[next];
            setActive(code);
            setFeedback({});
            tabRefs.current[code]?.focus();
          }}
        >
          {tabs.map((code) => {
            const l = byLocale.get(code);
            const issues = l ? listingIssues(l, store, usesTablet) : [];
            return (
              <button
                key={code}
                ref={(el) => {
                  tabRefs.current[code] = el;
                }}
                type="button"
                role="tab"
                id={`listing-tab-${code}`}
                aria-selected={active === code}
                aria-controls="listing-panel"
                tabIndex={active === code ? 0 : -1}
                disabled={busy}
                title={issues.length > 0 ? `Incomplete: ${issues.join(", ")}` : undefined}
                onClick={() => {
                  setActive(code);
                  setFeedback({});
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                  active === code
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {localeLabel(store, code)}
                {issues.length > 0 ? (
                  <>
                    {/* Rouge Abort quel que soit l'état de l'onglet (le fond plein
                        de la pastille reste lisible même sur l'onglet actif). */}
                    <IconAlertBadge className="text-destructive" />
                    <span className="sr-only">(incomplete: {issues.join(", ")})</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>

        {listing ? (
          <div
            className="flex flex-col gap-4"
            role="tabpanel"
            id="listing-panel"
            aria-labelledby={`listing-tab-${active}`}
          >
            {/* Base de mots clés éditable: ajout/suppression. Sert d'entrée à
                « Régénérer cette langue ». */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-keyword">Keywords ({keywords.length})</Label>
              {keywords.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {keywords.map((k) => (
                    <span
                      key={k.keyword}
                      className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs"
                    >
                      {k.keyword}
                      {k.competitors > 0 ? (
                        <span
                          className="text-muted-foreground"
                          title={`${k.competitors} competitor(s) · ${k.occurrences} occurrence(s)`}
                        >
                          ×{k.competitors}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeKeyword(k.keyword)}
                        disabled={busy}
                        aria-label={`Remove keyword ${k.keyword}`}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <IconX className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <Input
                  id="new-keyword"
                  value={newKeyword}
                  disabled={busy}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                  placeholder="Add a keyword…"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addKeyword}
                  disabled={busy || !newKeyword.trim()}
                >
                  Add
                </Button>
              </div>
              <p className="max-w-prose text-xs text-muted-foreground">
                These words guide generation. “Regenerate this language”
                rewrites the listing from this list. ×N shows the number of
                competitors that use the word.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="listing-title">Title</Label>
                <CharCount value={form.title} max={STORE_LIMITS.title} />
              </div>
              <Input
                id="listing-title"
                value={form.title}
                disabled={busy}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            {store === "appstore" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="listing-subtitle">Subtitle</Label>
                  <CharCount value={form.subtitle} max={STORE_LIMITS.subtitle} />
                </div>
                <Input
                  id="listing-subtitle"
                  value={form.subtitle}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="listing-short">Short description</Label>
                  <CharCount
                    value={form.short_description}
                    max={STORE_LIMITS.shortDescription}
                  />
                </div>
                <Input
                  id="listing-short"
                  value={form.short_description}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({ ...form, short_description: e.target.value })
                  }
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="listing-description">
                  {store === "appstore" ? "Description" : "Long description"}
                </Label>
                <CharCount value={form.description} max={STORE_LIMITS.description} />
              </div>
              <textarea
                id="listing-description"
                value={form.description}
                disabled={busy}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={12}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {store === "appstore" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="listing-keywords">Keywords field</Label>
                  <CharCount value={form.keywords} max={STORE_LIMITS.keywords} />
                </div>
                <Input
                  id="listing-keywords"
                  value={form.keywords}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  placeholder="word1,word2,word3"
                />
                <p className="max-w-prose text-xs text-muted-foreground">
                  Invisible App Store search field: words separated by commas,
                  no spaces, 100 characters max.
                </p>
              </div>
            ) : null}

            {showWhatsNew ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="listing-whats-new">
                    What&apos;s New in This Version
                  </Label>
                  <CharCount value={form.whats_new} max={WHATS_NEW_MAX} />
                </div>
                <AutoTextarea
                  id="listing-whats-new"
                  value={form.whats_new}
                  maxLength={WHATS_NEW_MAX}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, whats_new: e.target.value })}
                />
                <p className="max-w-prose text-xs text-muted-foreground">
                  Auto-translated from your project What&apos;s New. Edit it for this
                  language; saving the source again re-translates every language.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {/* Saves de carte en outline: le primary est réservé aux deux
                  CTA de page (Générer, Publier). */}
              <Button
                type="button"
                variant="outline"
                onClick={handleSave}
                disabled={busy || !formDirty}
              >
                {saving ? (
                  <>
                    <Spinner /> Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
              <Button
                type="button"
                variant={confirmRegen ? "destructive" : "ghost"}
                onClick={handleRegenerate}
                onBlur={() => setConfirmRegen(false)}
                disabled={busy}
              >
                {regenerating ? (
                  <>
                    <Spinner /> Regenerating…
                  </>
                ) : confirmRegen ? (
                  "Confirm: overwrite and regenerate · 1 credit"
                ) : (
                  "Regenerate this language · 1 credit"
                )}
              </Button>
              <Button
                type="button"
                variant={confirmDelete ? "destructive" : "ghost"}
                onClick={handleDelete}
                onBlur={() => setConfirmDelete(false)}
                disabled={busy}
                className={confirmDelete ? "" : "text-destructive hover:text-destructive"}
              >
                {deleting ? (
                  <>
                    <Spinner /> Deleting…
                  </>
                ) : confirmDelete ? (
                  "Confirm deletion"
                ) : (
                  "Delete"
                )}
              </Button>
            </div>

            {/* Retour d'action au contact des boutons: rendu plus bas (après les
                screenshots), une erreur de régénération tombait hors écran et
                l'échec passait pour « rien ne se passe ». */}
            {feedback.error ? (
              <p role="alert" className="text-sm text-destructive">
                {feedback.error}
              </p>
            ) : null}
            {feedback.message ? (
              <p role="status" className="text-sm text-tertiary">
                {feedback.message}
              </p>
            ) : null}

            {/* Screenshots générés pour cette langue */}
            {frames.length > 0 ? (
              <div className="flex flex-col gap-3 border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <Label>Screenshots ({frames.length})</Label>
                  <div className="flex items-center gap-3">
                    <a
                      href={`/api/projects/${projectId}/screenshots-zip?locale=${encodeURIComponent(active)}`}
                      className="text-sm font-medium text-primary hover:underline"
                      download
                    >
                      Download ZIP
                    </a>
                    <Button
                      type="button"
                      size="sm"
                      variant={confirmDeleteShots === "phone" ? "destructive" : "ghost"}
                      onClick={() => handleDeleteScreenshots("phone")}
                      onBlur={() => setConfirmDeleteShots(null)}
                      disabled={busy}
                      className={
                        confirmDeleteShots === "phone"
                          ? ""
                          : "text-destructive hover:text-destructive"
                      }
                    >
                      {deletingShots === "phone" ? (
                        <>
                          <Spinner /> Deleting…
                        </>
                      ) : confirmDeleteShots === "phone" ? (
                        "Confirm deletion"
                      ) : (
                        "Delete"
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drag the handle to reorder. It applies to all languages and to
                  publishing on the store.
                </p>
                <SortableList
                  ids={frames.map((f) => f.sourcePath)}
                  onReorder={(ids) => handleReorderFrames("phone", ids)}
                  strategy="grid"
                  disabled={busy}
                  className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                >
                  {frames.map((frame) => (
                    <SortableItem
                      key={frame.sourcePath}
                      id={frame.sourcePath}
                      disabled={busy}
                      className="flex flex-col gap-2"
                    >
                      {({ attributes, listeners, isDragging }) => (
                        <>
                          <div className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element -- rendu stocké bucket public */}
                            <img
                              src={frame.url}
                              alt={frame.caption}
                              draggable={false}
                              className="w-full rounded-lg border"
                            />
                            <button
                              type="button"
                              {...attributes}
                              {...listeners}
                              aria-label="Move screenshot"
                              className={cn(
                                "absolute left-2 top-2 flex h-7 w-7 touch-none items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isDragging ? "cursor-grabbing" : "cursor-grab"
                              )}
                            >
                              <IconGrip className="h-4 w-4" />
                            </button>
                          </div>
                          <AutoTextarea
                            value={captionEdits[frame.sourcePath] ?? frame.caption}
                            disabled={busy}
                            onChange={(e) =>
                              setCaptionEdits((prev) => ({
                                ...prev,
                                [frame.sourcePath]: e.target.value,
                              }))
                            }
                            aria-label="Screenshot caption"
                          />
                        </>
                      )}
                    </SortableItem>
                  ))}
                </SortableList>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleRerenderCaptions("phone")}
                    disabled={busy || !captionsDirty}
                  >
                    {rerendering === "phone" ? (
                      <>
                        <Spinner /> Re-render…
                      </>
                    ) : (
                      "Save captions & re-render"
                    )}
                  </Button>
                </div>
              </div>
            ) : hasShots ? (
              /* Aucun screenshot pour cette langue alors que des captures
                 sources existent: on propose de les générer ici plutôt que de
                 renvoyer l'utilisateur au CTA principal (qui régénérerait le
                 texte de toutes les langues). */
              <div className="flex flex-col items-start gap-2 border-t pt-4">
                <Label>Screenshots</Label>
                <p className="max-w-prose text-sm text-muted-foreground">
                  No screenshot generated for this language.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGenerateScreenshots}
                  disabled={busy}
                >
                  {generatingShots ? (
                    <>
                      <Spinner /> Generating…
                    </>
                  ) : (
                    "Generate screenshots · 1 credit"
                  )}
                </Button>
              </div>
            ) : null}

            {/* Screenshots iPad / tablette générés pour cette langue */}
            {tabletFrames.length > 0 ? (
              <div className="flex flex-col gap-3 border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <Label>
                    {store === "appstore" ? "iPad screenshots" : "Tablet screenshots"} (
                    {tabletFrames.length})
                  </Label>
                  <div className="flex items-center gap-3">
                    <a
                      href={`/api/projects/${projectId}/screenshots-zip?locale=${encodeURIComponent(active)}&device=tablet`}
                      className="text-sm font-medium text-primary hover:underline"
                      download
                    >
                      Download ZIP
                    </a>
                    <Button
                      type="button"
                      size="sm"
                      variant={confirmDeleteShots === "tablet" ? "destructive" : "ghost"}
                      onClick={() => handleDeleteScreenshots("tablet")}
                      onBlur={() => setConfirmDeleteShots(null)}
                      disabled={busy}
                      className={
                        confirmDeleteShots === "tablet"
                          ? ""
                          : "text-destructive hover:text-destructive"
                      }
                    >
                      {deletingShots === "tablet" ? (
                        <>
                          <Spinner /> Deleting…
                        </>
                      ) : confirmDeleteShots === "tablet" ? (
                        "Confirm deletion"
                      ) : (
                        "Delete"
                      )}
                    </Button>
                  </div>
                </div>
                <SortableList
                  ids={tabletFrames.map((f) => f.sourcePath)}
                  onReorder={(ids) => handleReorderFrames("tablet", ids)}
                  strategy="grid"
                  disabled={busy}
                  className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                >
                  {tabletFrames.map((frame) => (
                    <SortableItem
                      key={frame.sourcePath}
                      id={frame.sourcePath}
                      disabled={busy}
                      className="flex flex-col gap-2"
                    >
                      {({ attributes, listeners, isDragging }) => (
                        <>
                          <div className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element -- rendu stocké bucket public */}
                            <img
                              src={frame.url}
                              alt={frame.caption}
                              draggable={false}
                              className="w-full rounded-lg border"
                            />
                            <button
                              type="button"
                              {...attributes}
                              {...listeners}
                              aria-label="Move screenshot"
                              className={cn(
                                "absolute left-2 top-2 flex h-7 w-7 touch-none items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isDragging ? "cursor-grabbing" : "cursor-grab"
                              )}
                            >
                              <IconGrip className="h-4 w-4" />
                            </button>
                          </div>
                          <AutoTextarea
                            value={captionEditsTablet[frame.sourcePath] ?? frame.caption}
                            disabled={busy}
                            onChange={(e) =>
                              setCaptionEditsTablet((prev) => ({
                                ...prev,
                                [frame.sourcePath]: e.target.value,
                              }))
                            }
                            aria-label="Tablet screenshot caption"
                          />
                        </>
                      )}
                    </SortableItem>
                  ))}
                </SortableList>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleRerenderCaptions("tablet")}
                    disabled={busy || !tabletCaptionsDirty}
                  >
                    {rerendering === "tablet" ? (
                      <>
                        <Spinner /> Re-render…
                      </>
                    ) : (
                      "Save captions & re-render"
                    )}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a generated language.
          </p>
        )}

      </CardContent>
    </Card>
  );
}
