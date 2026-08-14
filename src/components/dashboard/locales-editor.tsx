"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { updateProjectLocales } from "@/app/(app)/actions";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { IconWarning } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Spinner } from "@/components/ui/spinner";
import { STORE_LOCALES } from "@/lib/locales";
import type { StorePlatform } from "@/types";

/**
 * Sélection des langues cibles. La génération se fait via le CTA principal
 * en bas de page (fiches + screenshots pour les langues enregistrées).
 */
export function LocalesEditor({
  projectId,
  store,
  initial,
}: {
  projectId: string;
  store: StorePlatform;
  initial: string[];
}) {
  const router = useRouter();
  // pageBusy = génération/publication en cours (verrou global). Le save des
  // langues ne lève pas ce verrou: il ne fige que ce bloc via `saving`. En
  // revanche il signale `localesSaving` pour désactiver le bouton Générer tant
  // que la liste n'est pas commitée.
  const { busy: pageBusy, startLocalesSave, endLocalesSave, setSelectedLocales } =
    useProjectBusy();
  const [selected, setSelected] = React.useState<string[]>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  // Partage la sélection LIVE au CTA de génération: son compteur suit alors le
  // choix immédiatement, sans dépendre du save + router.refresh. Réinitialisé au
  // démontage pour ne pas fuiter la sélection d'un projet à l'autre.
  React.useEffect(() => {
    setSelectedLocales(selected);
  }, [selected, setSelectedLocales]);
  React.useEffect(() => () => setSelectedLocales(null), [setSelectedLocales]);

  const busy = saving || pageBusy;
  const dirty =
    JSON.stringify([...selected].sort()) !== JSON.stringify([...initial].sort());

  // `values` explicite: à la fermeture on sauve la sélection fraîche remontée
  // par MultiSelect, pas l'état local qui peut suivre avec un frame de retard.
  async function handleSave(values: string[] = selected) {
    setSaving(true);
    startLocalesSave();
    setError(null);
    setMessage(null);
    try {
      const res = await updateProjectLocales({ projectId, locales: values });
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage("Languages saved.");
      router.refresh();
    } finally {
      setSaving(false);
      endLocalesSave();
    }
  }

  // Auto-save à la fermeture du menu, seulement si la sélection a changé.
  function handleCloseAutoSave(values: string[]) {
    const changed =
      JSON.stringify([...values].sort()) !== JSON.stringify([...initial].sort());
    if (changed && !busy) void handleSave(values);
  }

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="project-locales">Target languages ({selected.length})</Label>
      <MultiSelect
        id="project-locales"
        name="target_locales"
        options={STORE_LOCALES[store]}
        defaultSelected={initial}
        placeholder="Choose languages…"
        searchPlaceholder="Search a language…"
        summaryFormatter={(c) => `${c} languages selected`}
        onSelectionChange={setSelected}
        onClose={handleCloseAutoSave}
        disabled={busy}
      />
      {store === "appstore" ? (
        <div className="flex items-start gap-2 rounded-md border-2 border-destructive bg-destructive/10 p-3">
          <IconWarning className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="max-w-prose text-xs text-foreground">
            <span className="font-semibold text-destructive">
              Each language must already exist in App Store Connect.
            </span>{" "}
            We can update a language, but not create it. If it&rsquo;s missing, publishing
            will fail. Add it from the version&rsquo;s language menu and click Save. It can
            stay empty, we&rsquo;ll fill in the content from here.
          </p>
        </div>
      ) : null}
      {/* Le save part tout seul à la fermeture du menu; ce bouton reste comme
          filet (sauvegarde immédiate, ou nouvelle tentative après une erreur). */}
      {dirty || saving ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleSave()}
            disabled={busy || !dirty}
          >
            {saving ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              "Save languages"
            )}
          </Button>
        </div>
      ) : null}
      <p className="max-w-prose text-xs text-muted-foreground">
        Saved automatically when the menu closes. Generate via the{" "}
        <a href="#generer" className="underline underline-offset-2 hover:text-foreground">
          “Generate listings”
        </a>{" "}
        button below.
      </p>
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
