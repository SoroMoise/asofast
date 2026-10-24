"use client";

import * as React from "react";

type BannerState = {
  defaultBanner: boolean;
  locales: { locale: string; url: string | null; stale: boolean; supported: boolean }[];
};

/**
 * Récapitulatif Play Store avant publication: quelles langues partent avec
 * LEUR bannière localisée, lesquelles héritent de la bannière par défaut. Relu à
 * chaque `refreshKey` (ex.: au moment de confirmer), car les bannières se
 * génèrent sur la même page.
 */
export function FeatureGraphicPublishSummary({
  projectId,
  locales,
  labels,
  refreshKey,
}: {
  projectId: string;
  /** Langues sélectionnées pour la publication. */
  locales: string[];
  labels: Map<string, string>;
  refreshKey: number;
}) {
  const [state, setState] = React.useState<BannerState | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/feature-graphics`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<BannerState>) : null))
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {
        // Récapitulatif indicatif: sans lui, la publication reste possible.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  if (!state || locales.length === 0) return null;

  const byLocale = new Map(state.locales.map((l) => [l.locale, l]));
  const own = locales.filter((l) => {
    const s = byLocale.get(l);
    return Boolean(s?.supported && s.url);
  });
  const inherited = locales.filter((l) => !own.includes(l));
  const outdated = own.filter((l) => byLocale.get(l)?.stale);
  const name = (l: string) => labels.get(l) ?? l;

  return (
    <div className="ml-6 flex max-w-prose flex-col gap-0.5 text-xs text-muted-foreground">
      {own.length > 0 ? (
        <p>
          Own banner ({own.length}): {own.map(name).join(", ")}
        </p>
      ) : null}
      {inherited.length > 0 ? (
        <p>
          Default banner ({inherited.length}): {inherited.map(name).join(", ")}
          {state.defaultBanner
            ? ""
            : ". No default banner uploaded: these languages keep what Google Play shows today."}
        </p>
      ) : null}
      {outdated.length > 0 ? (
        <p className="text-amber-600">
          Outdated: {outdated.map(name).join(", ")}. Regenerate them in the Feature graphic card
          to publish the current template.
        </p>
      ) : null}
    </div>
  );
}
