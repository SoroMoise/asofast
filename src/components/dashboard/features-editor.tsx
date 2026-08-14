"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { updateProjectFeatures } from "@/app/(app)/actions";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { IconX } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { MAX_FEATURE_LENGTH, MAX_FEATURES } from "@/lib/constants";

/**
 * Fonctionnalités clés de l'app: une ligne par fonctionnalité, éditables,
 * injectées dans la description générée (toutes langues).
 */
export function FeaturesEditor({
  projectId,
  initial,
}: {
  projectId: string;
  initial: string[];
}) {
  const router = useRouter();
  // pageBusy = génération/publication en cours (verrou global). Le save des
  // fonctionnalités ne lève pas ce verrou: il ne fige que ce bloc via `saving`.
  const { busy: pageBusy } = useProjectBusy();
  const [features, setFeatures] = React.useState<string[]>(
    initial.length > 0 ? initial : [""]
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const blocked = saving || pageBusy;

  const dirty =
    JSON.stringify(features.map((f) => f.trim()).filter(Boolean)) !==
    JSON.stringify(initial);

  function setAt(i: number, value: string) {
    setFeatures((prev) => prev.map((f, j) => (j === i ? value : f)));
    setMessage(null);
  }

  function removeAt(i: number) {
    setFeatures((prev) => {
      const next = prev.filter((_, j) => j !== i);
      return next.length > 0 ? next : [""];
    });
    setMessage(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const cleaned = features.map((f) => f.trim()).filter(Boolean);
      const res = await updateProjectFeatures({ projectId, features: cleaned });
      if (res.error) {
        setError(res.error);
        return;
      }
      setFeatures(cleaned.length > 0 ? cleaned : [""]);
      setMessage("Features saved.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Le titre de carte porte déjà « Fonctionnalités clés »: pas de doublon. */}
      <Label htmlFor="project-feature-0">
        One line per feature ({features.filter((f) => f.trim()).length}/{MAX_FEATURES})
      </Label>
      {features.map((feature, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            id={`project-feature-${i}`}
            value={feature}
            maxLength={MAX_FEATURE_LENGTH}
            disabled={blocked}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder="Ex: Calorie tracking by photo"
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            disabled={blocked}
            aria-label="Remove this feature"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconX />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {features.length < MAX_FEATURES ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked}
            onClick={() => setFeatures((prev) => [...prev, ""])}
          >
            + Add a feature
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={blocked || !dirty}
        >
          {saving ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
      <p className="max-w-prose text-xs text-muted-foreground">
        Included in the generated description, translated into each target
        language. Apply to the next generations.
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
