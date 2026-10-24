"use client";

import * as React from "react";

import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { IconUpload } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  FEATURE_GRAPHIC_HEIGHT,
  FEATURE_GRAPHIC_WIDTH,
  MAX_BADGE_LENGTH,
  MAX_BADGES,
  MAX_HEADLINE_LENGTH,
  SAFE_MARGIN_X,
  type FeatureGraphicTemplate,
  type FeatureGraphicTexts,
} from "@/lib/aso/feature-graphic-layout";
import { compressImage } from "@/lib/images/compress";
import { STORE_LOCALES } from "@/lib/locales";

type LocaleState = { locale: string; url: string | null; texts: FeatureGraphicTexts | null };
type ApiState = {
  configured: boolean;
  template: FeatureGraphicTemplate;
  art: string | null;
  sourceLocale: string;
  locales: LocaleState[];
};
type GenerateResult = {
  done?: { locale: string; url: string; texts: FeatureGraphicTexts }[];
  failed?: { locale: string; error: string }[];
  error?: string;
};

// Petits lots: chaque requête rend N bannières à la suite (satori bloque la
// boucle), et le client affiche l'avancement entre deux lots.
const BATCH_SIZE = 6;

const LOCALE_LABELS = new Map(STORE_LOCALES.playstore.map((o) => [o.value, o.label]));

const SAFE_PCT = `${((SAFE_MARGIN_X / FEATURE_GRAPHIC_WIDTH) * 100).toFixed(2)}%`;

/** Repères de la zone de sécurité (le Play Store rogne les côtés dans ses cartes). */
function SafeZone({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full max-w-xl">
      {children}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-amber-400/90"
        style={{ left: SAFE_PCT }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 border-r-2 border-dashed border-amber-400/90"
        style={{ right: SAFE_PCT }}
      />
    </div>
  );
}

function padBadges(badges: string[]): string[] {
  return [...badges, "", "", ""].slice(0, MAX_BADGES);
}

/**
 * Bannière Google Play LOCALISÉE: une illustration sans texte + un modèle
 * (titre, badges) → une bannière par langue, texte traduit. Publiée sur chaque
 * langue de la fiche (la bannière unique ne va que sur la langue par défaut).
 */
export function LocalizedFeatureGraphic({ projectId }: { projectId: string }) {
  const api = `/api/projects/${projectId}/feature-graphics`;
  const { busy: pageBusy, start, end } = useProjectBusy();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [state, setState] = React.useState<ApiState | null>(null);
  const [tpl, setTpl] = React.useState<FeatureGraphicTemplate | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = React.useState<{ locale: string; error: string }[]>([]);
  const [preview, setPreview] = React.useState<string>("");
  const [edit, setEdit] = React.useState<{ headline: string; badges: string[] }>({
    headline: "",
    badges: padBadges([]),
  });
  const blocked = busy || pageBusy;

  const refresh = React.useCallback(async () => {
    const res = await fetch(api, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as ApiState;
    setState(data);
    setTpl((current) => current ?? data.template);
    setPreview((current) => current || data.sourceLocale);
  }, [api]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const previewState = state?.locales.find((l) => l.locale === preview) ?? null;
  React.useEffect(() => {
    setEdit({
      headline: previewState?.texts?.headline ?? "",
      badges: padBadges(previewState?.texts?.badges ?? []),
    });
  }, [previewState?.locale, previewState?.url, previewState?.texts]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    start();
    setError(null);
    setMessage(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed.");
    } finally {
      setBusy(false);
      end();
    }
  }

  async function saveTemplate(): Promise<void> {
    if (!tpl) return;
    const res = await fetch(api, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...tpl, badges: tpl.badges.filter(Boolean) }),
    });
    const data = (await res.json()) as { template?: FeatureGraphicTemplate; error?: string };
    if (!res.ok || !data.template) throw new Error(data.error ?? "Save failed.");
    setTpl(data.template);
  }

  async function handleArt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await run(async () => {
      const out = await compressImage(file, {
        fit: { width: FEATURE_GRAPHIC_WIDTH, height: FEATURE_GRAPHIC_HEIGHT },
        allowAlpha: true,
      });
      const list = await fetch(`/api/files/${projectId}/feature-graphic`).then((r) =>
        r.ok ? (r.json() as Promise<{ files?: { name: string; path: string }[] }>) : { files: [] }
      );
      for (const f of (list.files ?? []).filter((f) => f.name.startsWith("art."))) {
        await fetch(`/api/files/${f.path}`, { method: "DELETE" });
      }
      const up = await fetch(`/api/files/${projectId}/feature-graphic/art.${out.ext}`, {
        method: "POST",
        body: out.blob,
        headers: { "Content-Type": out.blob.type || "application/octet-stream" },
      });
      if (!up.ok) throw new Error("Upload failed.");
      setMessage("Illustration saved. Generate the banners to apply it.");
    });
  }

  async function generate(locales: string[]) {
    await run(async () => {
      await saveTemplate();
      setFailed([]);
      setProgress({ done: 0, total: locales.length });
      const allFailed: { locale: string; error: string }[] = [];
      for (let i = 0; i < locales.length; i += BATCH_SIZE) {
        const batch = locales.slice(i, i + BATCH_SIZE);
        const res = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locales: batch }),
        });
        const data = (await res.json()) as GenerateResult;
        if (!res.ok) throw new Error(data.error ?? "Generation failed.");
        allFailed.push(...(data.failed ?? []));
        setProgress({ done: Math.min(i + batch.length, locales.length), total: locales.length });
      }
      setFailed(allFailed);
      setMessage(
        allFailed.length === 0
          ? `Banners generated for ${locales.length} language(s).`
          : `Generated ${locales.length - allFailed.length}/${locales.length}. Retry the failed ones below.`
      );
    });
  }

  async function saveLocaleTexts() {
    if (!previewState) return;
    await run(async () => {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locales: [previewState.locale],
          texts: { headline: edit.headline, badges: edit.badges.filter(Boolean) },
        }),
      });
      const data = (await res.json()) as GenerateResult;
      if (!res.ok) throw new Error(data.error ?? "Re-render failed.");
      if (data.failed?.length) throw new Error(data.failed[0].error);
      setMessage(`Banner re-rendered for ${previewState.locale}.`);
    });
  }

  if (!state || !tpl) {
    return <div className="h-24 animate-pulse rounded-lg bg-muted" aria-hidden="true" />;
  }

  const allLocales = state.locales.map((l) => l.locale);
  const missing = state.locales.filter((l) => !l.url).map((l) => l.locale);
  const ready = Boolean(state.art);
  const setT = (patch: Partial<FeatureGraphicTemplate>) => setTpl({ ...tpl, ...patch });

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Localized banner (recommended)</h3>
        <p className="max-w-prose text-xs text-muted-foreground">
          Upload an illustration WITHOUT text (1024×500, keep the {tpl.textSide} side free).
          ASOFAST writes the headline and badges on it in every language, then publishes each
          banner on its own language. Text in the user&apos;s language converts better than an
          English banner everywhere. Keep every important element between the dashed lines:
          Google Play crops up to ~{SAFE_MARGIN_X} px on each side in its cards.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {state.art ? (
          <div className="w-full max-w-sm">
            <SafeZone>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.art}
                alt="Banner illustration"
                className="w-full rounded-lg border"
                style={{
                  background: tpl.backgroundGradientTo
                    ? `linear-gradient(135deg, ${tpl.backgroundColor}, ${tpl.backgroundGradientTo})`
                    : tpl.backgroundColor,
                }}
              />
            </SafeZone>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No illustration yet.</p>
        )}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleArt}
            disabled={blocked}
            className="sr-only"
            aria-label="Banner illustration"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconUpload className="h-3.5 w-3.5" /> {state.art ? "Replace illustration" : "Upload illustration"}
          </Button>
        </div>
      </div>

      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={tpl.useListingTitle}
            onChange={(e) => setT({ useListingTitle: e.target.checked })}
            disabled={blocked}
          />
          Headline = listing title of each language (already localized, no translation)
        </label>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="fg-headline">Headline ({state.sourceLocale})</Label>
          <Input
            id="fg-headline"
            value={tpl.headline}
            maxLength={MAX_HEADLINE_LENGTH}
            disabled={blocked || tpl.useListingTitle}
            onChange={(e) => setT({ headline: e.target.value })}
            placeholder="Convert 148 currencies, even offline"
          />
        </div>
        {padBadges(tpl.badges).map((badge, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Label htmlFor={`fg-badge-${i}`}>Badge {i + 1}</Label>
            <Input
              id={`fg-badge-${i}`}
              value={badge}
              maxLength={MAX_BADGE_LENGTH}
              disabled={blocked}
              onChange={(e) => {
                const next = padBadges(tpl.badges);
                next[i] = e.target.value;
                setT({ badges: next });
              }}
              placeholder={["Works offline", "Live rates", "148 currencies"][i]}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor="fg-side">Text side</Label>
          <select
            id="fg-side"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={tpl.textSide}
            disabled={blocked}
            onChange={(e) => setT({ textSide: e.target.value === "right" ? "right" : "left" })}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="fg-width">Text width ({Math.round(tpl.textWidth * 100)}%)</Label>
          <input
            id="fg-width"
            type="range"
            min={35}
            max={65}
            value={Math.round(tpl.textWidth * 100)}
            disabled={blocked}
            onChange={(e) => setT({ textWidth: Number(e.target.value) / 100 })}
          />
        </div>
        <div className="flex items-end gap-3 sm:col-span-2">
          <label className="flex flex-col gap-1 text-xs">
            Text
            <input type="color" value={tpl.textColor} disabled={blocked} onChange={(e) => setT({ textColor: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Background
            <input type="color" value={tpl.backgroundColor} disabled={blocked} onChange={(e) => setT({ backgroundColor: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Gradient to
            <input
              type="color"
              value={tpl.backgroundGradientTo ?? tpl.backgroundColor}
              disabled={blocked || tpl.backgroundGradientTo === null}
              onChange={(e) => setT({ backgroundGradientTo: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={tpl.backgroundGradientTo !== null}
              disabled={blocked}
              onChange={(e) => setT({ backgroundGradientTo: e.target.checked ? "#7c3aed" : null })}
            />
            Gradient
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={blocked} onClick={() => run(saveTemplate)}>
          Save template
        </Button>
        <Button type="button" size="sm" disabled={blocked || !ready} onClick={() => generate(allLocales)}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
          Generate banners ({allLocales.length} languages)
        </Button>
        {missing.length > 0 && missing.length < allLocales.length ? (
          <Button type="button" variant="outline" size="sm" disabled={blocked || !ready} onClick={() => generate(missing)}>
            Only missing ({missing.length})
          </Button>
        ) : null}
      </div>
      {progress && busy ? (
        <p className="text-xs text-muted-foreground">
          {progress.done}/{progress.total} languages…
        </p>
      ) : null}

      {state.locales.some((l) => l.url) ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="fg-preview">Preview</Label>
            <select
              id="fg-preview"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
            >
              {state.locales.map((l) => (
                <option key={l.locale} value={l.locale}>
                  {LOCALE_LABELS.get(l.locale) ?? l.locale}
                  {l.url ? "" : " (not generated)"}
                </option>
              ))}
            </select>
          </div>
          {previewState?.url ? (
            <>
              <SafeZone>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewState.url}
                  alt={`Banner ${previewState.locale}`}
                  className="w-full rounded-lg border"
                />
              </SafeZone>
              <div className="grid max-w-2xl gap-2 sm:grid-cols-2">
                <Input
                  className="sm:col-span-2"
                  value={edit.headline}
                  maxLength={MAX_HEADLINE_LENGTH}
                  disabled={blocked}
                  onChange={(e) => setEdit({ ...edit, headline: e.target.value })}
                  aria-label="Headline for this language"
                />
                {edit.badges.map((badge, i) => (
                  <Input
                    key={i}
                    value={badge}
                    maxLength={MAX_BADGE_LENGTH}
                    disabled={blocked}
                    onChange={(e) => {
                      const next = [...edit.badges];
                      next[i] = e.target.value;
                      setEdit({ ...edit, badges: next });
                    }}
                    aria-label={`Badge ${i + 1} for this language`}
                  />
                ))}
              </div>
              <div>
                <Button type="button" variant="outline" size="sm" disabled={blocked} onClick={saveLocaleTexts}>
                  Save text &amp; re-render this language
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No banner for this language yet.</p>
          )}
        </div>
      ) : null}

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {failed.length > 0 ? (
        <ul className="text-xs text-destructive">
          {failed.map((f) => (
            <li key={f.locale}>
              {f.locale}: {f.error}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
