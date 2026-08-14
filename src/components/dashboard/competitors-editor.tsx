"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { updateProjectCompetitors } from "@/app/(app)/actions";
import {
  AppChip,
  AppSearchInput,
  type AppRef,
} from "@/components/dashboard/app-search-input";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { StorePlatform } from "@/types";

const MAX_COMPETITORS = 5;

export function CompetitorsEditor({
  projectId,
  store,
  initial,
  projectIdentifier,
}: {
  projectId: string;
  store: StorePlatform;
  initial: AppRef[];
  /** Identifiant store de l'app du projet: jamais proposée comme compétiteur. */
  projectIdentifier: string;
}) {
  const router = useRouter();
  // pageBusy = génération/publication en cours (verrou global). L'édition des
  // compétiteurs ne lève pas ce verrou: elle ne fige que ce bloc via `saving`.
  const { busy: pageBusy } = useProjectBusy();
  const [competitors, setCompetitors] = React.useState<AppRef[]>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const blocked = saving || pageBusy;

  async function persist(next: AppRef[]) {
    setSaving(true);
    setError(null);
    const previous = competitors;
    setCompetitors(next);
    try {
      const res = await updateProjectCompetitors({ projectId, competitors: next });
      if (res.error) {
        setCompetitors(previous);
        setError(res.error);
      } else {
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  function add(app: AppRef) {
    if (competitors.length >= MAX_COMPETITORS) return;
    if (app.identifier === projectIdentifier) return;
    if (competitors.some((c) => c.identifier === app.identifier)) return;
    void persist([...competitors, app]);
  }

  function remove(identifier: string) {
    void persist(competitors.filter((c) => c.identifier !== identifier));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Le titre de carte porte déjà « Compétiteurs »: pas de doublon. */}
      <Label htmlFor="project-competitor" className="flex items-center gap-2">
        Competing apps ({competitors.length}/{MAX_COMPETITORS}, minimum 1 to generate)
        {saving ? <Spinner className="h-3.5 w-3.5" /> : null}
      </Label>
      {competitors.map((c) => (
        <AppChip
          key={c.identifier}
          app={c}
          onRemove={() => remove(c.identifier)}
          removeDisabled={blocked || competitors.length <= 1}
        />
      ))}
      {competitors.length < MAX_COMPETITORS ? (
        <AppSearchInput
          id="project-competitor"
          store={store}
          excludeIdentifiers={[projectIdentifier, ...competitors.map((c) => c.identifier)]}
          onAdd={add}
          onError={setError}
          disabled={blocked}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p className="max-w-prose text-xs text-muted-foreground">
        Their keywords guide generation. Changes apply to the next generations
        (listings and screenshots).
      </p>
    </div>
  );
}
