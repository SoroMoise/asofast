"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { updateProjectLegalLinks } from "@/app/(app)/actions";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { isHttpUrl, normalizeBaseUrl, relativeToBase, resolveLegalUrl } from "@/lib/legal-links";
import type { StorePlatform } from "@/types";

/**
 * URL de base du site + politique de confidentialité + conditions
 * d'utilisation du projet. Les trois liens sont ajoutés en bas de la
 * description de chaque langue (référencement du site), + EULA Apple sur iOS.
 * Confidentialité et conditions acceptent un chemin collé à la base ou une
 * URL complète.
 */
export function LegalLinksEditor({
  projectId,
  store,
  initialWebsite,
  initialPrivacy,
  initialTerms,
}: {
  projectId: string;
  store: StorePlatform;
  initialWebsite: string;
  initialPrivacy: string;
  initialTerms: string;
}) {
  const router = useRouter();
  // pageBusy = génération/publication en cours (verrou global). Le save des
  // liens ne lève pas ce verrou: il ne fige que ce bloc via `saving`.
  const { busy: pageBusy } = useProjectBusy();
  const initial = React.useMemo(
    () => ({
      website: initialWebsite,
      privacy: relativeToBase(initialWebsite, initialPrivacy),
      terms: relativeToBase(initialWebsite, initialTerms),
    }),
    [initialWebsite, initialPrivacy, initialTerms]
  );
  const [website, setWebsite] = React.useState(initial.website);
  const [privacy, setPrivacy] = React.useState(initial.privacy);
  const [terms, setTerms] = React.useState(initial.terms);
  // Le serveur normalise (slash final retiré, chemin résolu puis réaffiché
  // relatif): on se recale sur les valeurs stockées après chaque refresh,
  // sinon le bloc resterait « dirty » juste après un save réussi.
  React.useEffect(() => {
    setWebsite(initial.website);
    setPrivacy(initial.privacy);
    setTerms(initial.terms);
  }, [initial]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const blocked = saving || pageBusy;
  const dirty =
    website.trim() !== initial.website ||
    privacy.trim() !== initial.privacy ||
    terms.trim() !== initial.terms;

  const preview = [
    { label: "Website", url: normalizeBaseUrl(website) },
    { label: "Privacy Policy", url: resolveLegalUrl(website, privacy) },
    { label: "Terms of Use", url: resolveLegalUrl(website, terms) },
  ]
    // Pas d'aperçu d'un lien que le serveur refusera (base sans https://, etc.).
    .filter((l) => l.url && isHttpUrl(l.url) && !/\s/.test(l.url));

  function touched() {
    setMessage(null);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await updateProjectLegalLinks({
        projectId,
        websiteUrl: website.trim(),
        privacyPolicy: privacy.trim(),
        terms: terms.trim(),
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage("Links saved.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="legal-website-url">Website URL</Label>
        <Input
          id="legal-website-url"
          type="url"
          value={website}
          disabled={blocked}
          onChange={(e) => {
            setWebsite(e.target.value);
            touched();
          }}
          placeholder="https://your-site.com"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="legal-privacy-path">Privacy policy (required)</Label>
        <Input
          id="legal-privacy-path"
          value={privacy}
          disabled={blocked}
          onChange={(e) => {
            setPrivacy(e.target.value);
            touched();
          }}
          placeholder="/privacy"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="legal-terms-path">Terms of use</Label>
        <Input
          id="legal-terms-path"
          value={terms}
          disabled={blocked}
          onChange={(e) => {
            setTerms(e.target.value);
            touched();
          }}
          placeholder="/terms"
        />
      </div>
      <p className="max-w-prose text-xs text-muted-foreground">
        Enter a path appended to the website URL (e.g. <code>/privacy</code>) or a
        full link. These links will be added to the end of the description in
        all languages, which also helps your website&apos;s SEO.
        {store === "appstore"
          ? " On iOS, Apple's standard EULA line is added as well."
          : ""}
      </p>
      {preview.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">
          {preview.map((l) => (
            <span key={l.label}>
              {l.label}: {l.url}
            </span>
          ))}
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleSave}
        disabled={blocked || !dirty}
        className="self-start"
      >
        {saving ? (
          <>
            <Spinner /> Saving…
          </>
        ) : (
          "Save"
        )}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-tertiary">
          {message}
        </p>
      ) : null}
    </div>
  );
}
