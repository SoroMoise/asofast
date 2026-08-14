"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { updateProjectWhatsNew } from "@/app/(app)/actions";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

const MAX = 4000;

/**
 * Release notes "What's New" du projet (langue source, optionnelles): traduites
 * dans toutes les langues cibles et poussées sur chaque fiche App Store Connect
 * à la publication.
 */
export function WhatsNewEditor({
  projectId,
  initial,
}: {
  projectId: string;
  initial: string;
}) {
  const router = useRouter();
  // pageBusy = génération/publication en cours (verrou global). Le save ne lève
  // pas ce verrou: il ne fige que ce bloc via `saving`.
  const { busy: pageBusy } = useProjectBusy();
  const [text, setText] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const blocked = saving || pageBusy;
  const dirty = text.trim() !== initial.trim();

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await updateProjectWhatsNew({ projectId, text: text.trim() });
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage("What's New saved.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="whats-new">What&apos;s New in This Version (optional)</Label>
      <AutoTextarea
        id="whats-new"
        value={text}
        maxLength={MAX}
        disabled={blocked}
        onChange={(e) => {
          setText(e.target.value);
          setMessage(null);
        }}
        placeholder="Ex: Fix minor bugs"
      />
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
      <p className="max-w-prose text-xs text-muted-foreground">
        These release notes are auto-translated into all your target languages and
        applied to the version being prepared in App Store Connect.
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
